import "server-only";
import { getCustomerConfig } from "./config/store";
import { DEFAULT_TEMP_UNIT, DEFAULT_THRESHOLDS, STREAM_INTERVAL_MS } from "./fleet";
import { Simulator } from "./simulator";
import type { Reading, SiteDef } from "./types";

/**
 * Data access layer. Every function takes customerId as its required first
 * argument. customerId must come from getSession() (the verified Cognito ID
 * token's custom:customer_id claim), never from the browser: not query
 * strings, bodies, headers, or client state.
 *
 * Site layout and labels come from DynamoDB ctm365_customer_config (edited
 * on /admin). Readings are still simulated; later they will query
 * ctm365_telemetry filtered by customer_id.
 */

function assertCustomerId(customerId: string) {
  if (typeof customerId !== "string" || customerId.trim() === "") {
    throw new Error("customerId is required");
  }
}

export async function getCustomerSite(customerId: string): Promise<SiteDef> {
  assertCustomerId(customerId);
  const config = await getCustomerConfig(customerId);
  if (!config) {
    // Not set up on /admin yet. The dashboard shows "no sensors configured yet".
    return {
      id: customerId,
      name: "Unnamed site",
      assets: [],
      sensors: [],
      unit: DEFAULT_TEMP_UNIT,
      thresholds: DEFAULT_THRESHOLDS,
    };
  }

  const assetIds = new Set(config.assets.map((a) => a.id));
  return {
    id: customerId,
    name: config.siteName || "Unnamed site",
    assets: config.assets,
    // A sensor pointing at a missing asset would show in the strip but not the table.
    sensors: config.sensors.filter((s) => assetIds.has(s.assetId)),
    unit: config.tempUnit,
    thresholds: config.thresholds,
  };
}

export interface ReadingStream {
  history: Reading[];
  subscribe(onReadings: (readings: Reading[]) => void): () => void;
}

export async function streamCustomerReadings(customerId: string): Promise<ReadingStream> {
  const site = await getCustomerSite(customerId);
  const sim = new Simulator(site.sensors.map((s) => s.id));
  const history = sim.backfill();

  return {
    history,
    subscribe(onReadings) {
      const timer = setInterval(() => onReadings(sim.tick()), STREAM_INTERVAL_MS);
      return () => clearInterval(timer);
    },
  };
}
