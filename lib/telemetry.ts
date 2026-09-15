import "server-only";
import { DEMO_SITE, STREAM_INTERVAL_MS } from "./fleet";
import { Simulator } from "./simulator";
import type { Reading, SiteDef } from "./types";

/**
 * Data access layer. Every function takes customerId as its first argument
 * so that, once auth is added, data is always scoped to the signed-in
 * customer. customerId must come from the verified Cognito ID token on the
 * server, never from the browser.
 *
 * Today these return simulated data. Later they will read
 * ctm365_customer_config and ctm365_telemetry in DynamoDB, filtered by
 * customer_id.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getCustomerSite(customerId: string): Promise<SiteDef> {
  return DEMO_SITE;
}

export interface ReadingStream {
  history: Reading[];
  subscribe(onReadings: (readings: Reading[]) => void): () => void;
}

export async function openCustomerReadingStream(customerId: string): Promise<ReadingStream> {
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
