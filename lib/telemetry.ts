import "server-only";
import { getCustomerConfig } from "./config/store";
import { samplesToReadings } from "./datacard";
import { getDatacardSamples } from "./electrical";
import { DEFAULT_TEMP_UNIT, DEFAULT_THRESHOLDS, ELECTRICAL_POLL_MS, HISTORY_WINDOW_MS } from "./fleet";
import { NO_SERVICES } from "./services";
import type { Reading, SiteDef } from "./types";

/**
 * Data access layer. Every function takes customerId as its required first
 * argument. customerId must come from getSession() (the verified Cognito ID
 * token's custom:customer_id claim), never from the browser: not query
 * strings, bodies, headers, or client state.
 *
 * Site layout and labels come from DynamoDB ctm365_customer_config (edited
 * on /admin). Electrical readings come from ctm365_telemetry, read only for
 * the datacard named in this customer's own config (see lib/electrical.ts).
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
    // Not set up on /admin yet. The dashboard says monitoring isn't set up.
    return {
      id: customerId,
      name: "Unnamed site",
      assets: [],
      sensors: [],
      unit: DEFAULT_TEMP_UNIT,
      thresholds: DEFAULT_THRESHOLDS,
      hvacUnits: [],
      services: NO_SERVICES,
      electricalDatacardId: null,
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
    hvacUnits: config.hvacUnits,
    services: config.services,
    electricalDatacardId: config.electricalDatacardId,
  };
}

export interface ReadingStream {
  history: Reading[];
  subscribe(onReadings: (readings: Reading[]) => void): () => void;
}

const NO_READINGS: ReadingStream = { history: [], subscribe: () => () => {} };

/**
 * The last 90 minutes of this customer's electrical readings, then new ones
 * as the datacard reports them. Returns null when the customer doesn't have
 * the electrical service; empty when no datacard or sensors are set up.
 */
export async function streamCustomerReadings(customerId: string): Promise<ReadingStream | null> {
  const site = await getCustomerSite(customerId);
  if (!site.services.electrical) return null;
  const datacardId = site.electricalDatacardId;
  if (!datacardId || site.sensors.length === 0) return NO_READINGS;

  let samples: Awaited<ReturnType<typeof getDatacardSamples>> = [];
  try {
    samples = await getDatacardSamples(datacardId, Date.now() - HISTORY_WINDOW_MS);
  } catch (err) {
    // Open the stream anyway: the page shows "no recent data" and polling retries.
    console.error(`[electrical] history read failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
  let lastTs = samples.at(-1)?.ts ?? Date.now() - HISTORY_WINDOW_MS;

  return {
    history: samplesToReadings(samples, site.sensors),
    subscribe(onReadings) {
      let stopped = false;
      let polling = false;
      const timer = setInterval(async () => {
        if (polling) return;
        polling = true;
        try {
          const next = await getDatacardSamples(datacardId, lastTs);
          if (stopped || next.length === 0) return;
          lastTs = next.at(-1)!.ts;
          const readings = samplesToReadings(next, site.sensors);
          if (readings.length > 0) onReadings(readings);
        } catch (err) {
          // Keep the stream open; the next poll retries.
          console.error(`[electrical] poll failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
        } finally {
          polling = false;
        }
      }, ELECTRICAL_POLL_MS);
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
  };
}
