import "server-only";
import { DEMO_SITE, STREAM_INTERVAL_MS } from "./fleet";
import { Simulator } from "./simulator";
import type { Reading, SiteDef } from "./types";

/**
 * Data access layer. Every function takes customerId as its required first
 * argument. customerId must come from getSession() (the verified Cognito ID
 * token's custom:customer_id claim), never from the browser: not query
 * strings, bodies, headers, or client state.
 *
 * Today these wrap the simulator. Later they will query DynamoDB
 * (ctm365_customer_config, and ctm365_telemetry filtered by customer_id).
 */

function assertCustomerId(customerId: string) {
  if (typeof customerId !== "string" || customerId.trim() === "") {
    throw new Error("customerId is required");
  }
}

export async function getCustomerSite(customerId: string): Promise<SiteDef> {
  assertCustomerId(customerId);
  return DEMO_SITE;
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
