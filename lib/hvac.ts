import "server-only";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { HVAC_UNIT_ID_PATTERN } from "./config/validation";
import { getCustomerSite } from "./telemetry";
import type { HvacReading, HvacUnitData } from "./types";

/**
 * HVAC readings from DynamoDB ctm365_hvac_telemetry: one item per unit per
 * minute, keyed by hvac_unit_id + timestamp ("2026-11-19T07:15:00Z"). Items
 * are written by the ctm365-hvac-ingest Lambda, already in engineering units.
 *
 * Tenant scoping: only units listed in this customer's config
 * (ctm365_customer_config.hvacUnits) are ever queried. customerId must come
 * from the verified session, never from the request.
 */

const TABLE_NAME = "ctm365_hvac_telemetry";
const REGION = "us-west-2";
/** Hard cap on how far back the dashboard reads, in hours. */
export const HVAC_MAX_HOURS = 168;

let client: DynamoDBDocumentClient | undefined;

function getClient() {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  return client;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function toReading(item: Record<string, unknown>): HvacReading | null {
  const ts = typeof item.timestamp === "string" ? Date.parse(item.timestamp) : NaN;
  if (!Number.isFinite(ts)) return null;
  return {
    ts,
    supplyF: num(item.air_supply_temp_f),
    returnF: num(item.air_return_temp_f),
    staticInwc: num(item.static_pressure_inwc),
    voltageV: num(item.voltage_v),
    voltageAnV: num(item.voltage_an_v),
    voltageAbV: num(item.voltage_ab_v),
    currentA: num(item.current_a),
    currentAA: num(item.current_a_a),
    currentBA: num(item.current_b_a),
    currentCA: num(item.current_c_a),
    powerW: num(item.power_w),
    powerFactor: num(item.power_factor),
    frequencyHz: num(item.frequency_hz),
    energyKwh: num(item.energy_kwh),
  };
}

async function queryUnit(unitId: string, sinceIso: string): Promise<HvacReading[]> {
  const readings: HvacReading[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await getClient().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "hvac_unit_id = :u AND #ts >= :since",
        ExpressionAttributeNames: { "#ts": "timestamp" },
        ExpressionAttributeValues: { ":u": unitId, ":since": sinceIso },
        ScanIndexForward: true,
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of out.Items ?? []) {
      const r = toReading(item);
      if (r) readings.push(r);
    }
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return readings;
}

/** Returns null when the customer doesn't have the HVAC service. */
export async function getHvacData(customerId: string, hours: number): Promise<HvacUnitData[] | null> {
  const site = await getCustomerSite(customerId);
  if (!site.services.hvac) return null;
  const span = Math.min(Math.max(1, Math.round(hours)), HVAC_MAX_HOURS);
  const since = new Date(Date.now() - span * 3600_000).toISOString().slice(0, 17) + "00Z";
  const units = site.hvacUnits.filter((u) => HVAC_UNIT_ID_PATTERN.test(u.id));
  return Promise.all(units.map(async (u) => ({ id: u.id, name: u.name, readings: await queryUnit(u.id, since) })));
}
