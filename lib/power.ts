import "server-only";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { samplePowerHistory } from "./sample-power";
import { getCustomerSite } from "./telemetry";
import type { PowerReading } from "./types";

/**
 * Electrical-panel voltage and current. The panel's WattNode publishes to
 * ctm365/<site>/power/<meter-id>; the ctm365_power_rule IoT rule sends it
 * through the same ingest Lambda as HVAC meters, so readings land in
 * ctm365_hvac_telemetry keyed by the meter ID, one item per minute.
 * Only the meter named in the signed-in customer's own config is read.
 */

const TABLE_NAME = "ctm365_hvac_telemetry";
const REGION = "us-west-2";
const WINDOW_MINUTES = 90;

let client: DynamoDBDocumentClient | undefined;
function getClient() {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  return client;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export interface PowerView {
  showVoltage: boolean;
  showCurrent: boolean;
  /** True when this is the demo panel, not a real meter. */
  sample: boolean;
  /** False when neither a meter nor sample data is set up. */
  connected: boolean;
  readings: PowerReading[];
}

/** null when the customer doesn't have electrical, or has voltage and current both switched off. */
export async function getPowerView(customerId: string): Promise<PowerView | null> {
  const site = await getCustomerSite(customerId);
  if (!site.services.electrical || (!site.showVoltage && !site.showCurrent)) return null;
  const base = { showVoltage: site.showVoltage, showCurrent: site.showCurrent };

  if (site.electricalSampleData) {
    return { ...base, sample: true, connected: true, readings: samplePowerHistory(Date.now(), WINDOW_MINUTES) };
  }
  if (!site.electricalPowerMeterId) return { ...base, sample: false, connected: false, readings: [] };

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString().slice(0, 17) + "00Z";
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await getClient().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "hvac_unit_id = :m AND #ts >= :since",
        ExpressionAttributeNames: { "#ts": "timestamp" },
        ExpressionAttributeValues: { ":m": site.electricalPowerMeterId, ":since": since },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(out.Items ?? []));
    startKey = out.LastEvaluatedKey;
  } while (startKey);

  const readings = items
    .map(
      (i): PowerReading => ({
        ts: Date.parse(String(i.timestamp)),
        voltsAN: num(i.voltage_an_v),
        voltsBN: num(i.voltage_bn_v),
        voltsCN: num(i.voltage_cn_v),
        voltsAB: num(i.voltage_ab_v),
        voltsBC: num(i.voltage_bc_v),
        voltsCA: num(i.voltage_ca_v),
        ampsA: num(i.current_a_a),
        ampsB: num(i.current_b_a),
        ampsC: num(i.current_c_a),
      }),
    )
    .filter((r) => Number.isFinite(r.ts))
    .sort((a, b) => a.ts - b.ts);
  return { ...base, sample: false, connected: true, readings };
}
