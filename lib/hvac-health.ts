import "server-only";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getCustomerSite } from "./telemetry";
import type { HvacCycle, HvacFinding, HvacHealth } from "./types";

/**
 * Reads HVAC health written by the ctm365-hvac-health job
 * (infra/lambda/ctm365-hvac-health), and restarts a unit's learning.
 * Only units in the signed-in customer's own config are ever read.
 */

const TABLE_NAME = "ctm365_hvac_analytics";
const REGION = "us-west-2";
/** Same time zone the job uses for "today". */
export const SITE_TIME_ZONE = "America/Los_Angeles";

let client: DynamoDBDocumentClient | undefined;
function getClient() {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return client;
}

export function siteDayKey(ts: number): string {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: SITE_TIME_ZONE });
}

/** UTC ms of local midnight for a site day, handling daylight saving. Same method as the job. */
export function siteDayStart(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const local = new Date(guess).toLocaleString("en-US", { timeZone: SITE_TIME_ZONE, hourCycle: "h23" });
    const [datePart, timePart] = local.split(", ");
    const [mm, dd, yy] = datePart.split("/").map(Number);
    const [hh, mi] = timePart.split(":").map(Number);
    guess += Date.UTC(y, m - 1, d) - Date.UTC(yy, mm - 1, dd, hh, mi);
  }
  return guess;
}

type Item = Record<string, unknown>;

function refrigerantView(r: unknown): HvacHealth["refrigerant"] {
  const x = r as Item | undefined;
  if (!x?.actual || !x.expected || !x.range) return undefined;
  return {
    actual: x.actual as NonNullable<HvacHealth["refrigerant"]>["actual"],
    expected: x.expected as NonNullable<HvacHealth["refrigerant"]>["expected"],
    range: x.range as NonNullable<HvacHealth["refrigerant"]>["range"],
    outdoorF: Number(x.outdoorF),
    chargeIndex: Number(x.chargeIndex),
  };
}

/** Health for each of the customer's HVAC units; null when the customer doesn't have HVAC. */
export async function getHvacHealth(customerId: string): Promise<HvacHealth[] | null> {
  const site = await getCustomerSite(customerId);
  if (!site.services.hvac) return null;
  if (site.hvacUnits.length === 0) return [];

  const today = siteDayKey(Date.now());
  const items: Item[] = [];
  const batchGet = async (keys: Item[], projection?: string) => {
    // BatchGet takes up to 100 keys per call.
    for (let i = 0; i < keys.length; i += 99) {
      const out = await getClient().send(
        new BatchGetCommand({
          RequestItems: {
            [TABLE_NAME]: {
              Keys: keys.slice(i, i + 99),
              ...(projection ? { ProjectionExpression: projection, ExpressionAttributeNames: { "#d": "days" } } : {}),
            },
          },
        }),
      );
      items.push(...((out.Responses?.[TABLE_NAME] ?? []) as Item[]));
    }
  };
  await Promise.all([
    batchGet(site.hvacUnits.flatMap((u) => [{ unit_id: u.id, sk: "latest" }, { unit_id: u.id, sk: `day#${today}` }])),
    // The baseline record carries a year of running totals; read only its summary.
    batchGet(site.hvacUnits.map((u) => ({ unit_id: u.id, sk: "baseline" })), "unit_id, sk, ready, #d, confidence, resetAt"),
  ]);
  const find = (unitId: string, sk: string) => items.find((x) => x.unit_id === unitId && x.sk === sk);

  // Two weeks of the daily low-charge pattern strength, for the charge trend.
  const since = siteDayKey(Date.now() - 14 * 86_400_000);
  const histories = await Promise.all(
    site.hvacUnits.map(async (u) => {
      const out = await getClient().send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "unit_id = :u AND sk BETWEEN :a AND :b",
          ExpressionAttributeValues: { ":u": u.id, ":a": `day#${since}`, ":b": `day#${today}` },
          ProjectionExpression: "#day, refResiduals.chargeIndex, customer_id",
          ExpressionAttributeNames: { "#day": "day" },
        }),
      );
      return (out.Items ?? [])
        .filter((d) => d.customer_id === customerId && Number.isFinite(Number((d.refResiduals as Item | undefined)?.chargeIndex)))
        .map((d) => ({ day: String(d.day), value: Number((d.refResiduals as Item).chargeIndex) }));
    }),
  );

  return site.hvacUnits.flatMap((u, unitIndex): HvacHealth[] => {
    const latest = find(u.id, "latest");
    // Belt and braces: never show analytics written for another customer.
    if (!latest || latest.customer_id !== customerId) return [];
    const day = find(u.id, `day#${today}`);
    const baseline = find(u.id, "baseline");
    const b = (latest.baseline ?? {}) as Item;
    return [
      {
        unitId: u.id,
        status: latest.status as HvacHealth["status"],
        score: Number(latest.score),
        categories: latest.categories as HvacHealth["categories"],
        findings: (latest.findings ?? []) as HvacFinding[],
        // The baseline record is current even right after "Start learning again"; latest catches up hourly.
        baseline: {
          ready: Boolean(baseline ? baseline.ready : b.ready),
          days: Number((baseline ? baseline.days : b.days) ?? 0),
          confidence: ((baseline?.confidence ?? b.confidence) as HvacHealth["baseline"]["confidence"]) ?? undefined,
          refrigerantModel: Boolean(b.refrigerantModel),
          refrigerantConfidence: (b.refrigerantConfidence as HvacHealth["baseline"]["refrigerantConfidence"]) ?? undefined,
          refrigerantSamples: Number(b.refrigerantSamples ?? 0),
          resetAt: typeof baseline?.resetAt === "string" ? baseline.resetAt : undefined,
        },
        refrigerant: refrigerantView(latest.refResiduals),
        chargeHistory: histories[unitIndex],
        computedAt: String(latest.computedAt),
        dayStart: siteDayStart(today),
        cycles: ((day?.cycles ?? []) as HvacCycle[]).map(({ start, end, runMin, cause, detail }) => ({ start, end, runMin, cause, detail })),
      },
    ];
  });
}

/**
 * Starts the unit's learning again from today: its "normal" is rebuilt from
 * days from today on. The next health run picks this up.
 */
export async function restartLearning(customerId: string, unitId: string): Promise<string> {
  const resetAt = siteDayKey(Date.now());
  await getClient().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { unit_id: unitId, sk: "baseline", customer_id: customerId, ready: false, days: 0, resetAt, updatedAt: new Date().toISOString() },
    }),
  );
  return resetAt;
}
