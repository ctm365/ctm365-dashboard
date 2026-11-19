import "server-only";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
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

/** Health for each of the customer's HVAC units; null when the customer doesn't have HVAC. */
export async function getHvacHealth(customerId: string): Promise<HvacHealth[] | null> {
  const site = await getCustomerSite(customerId);
  if (!site.services.hvac) return null;
  if (site.hvacUnits.length === 0) return [];

  const today = siteDayKey(Date.now());
  const keys = site.hvacUnits.flatMap((u) => [
    { unit_id: u.id, sk: "latest" },
    { unit_id: u.id, sk: `day#${today}` },
    { unit_id: u.id, sk: "baseline" },
  ]);
  const items: Item[] = [];
  // BatchGet takes up to 100 keys per call.
  for (let i = 0; i < keys.length; i += 99) {
    const out = await getClient().send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: keys.slice(i, i + 99) } } }));
    items.push(...((out.Responses?.[TABLE_NAME] ?? []) as Item[]));
  }
  const find = (unitId: string, sk: string) => items.find((x) => x.unit_id === unitId && x.sk === sk);

  return site.hvacUnits.flatMap((u): HvacHealth[] => {
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
          needed: Number(b.needed ?? 7),
          refrigerantModel: Boolean(b.refrigerantModel),
          resetAt: typeof baseline?.resetAt === "string" ? baseline.resetAt : undefined,
        },
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
