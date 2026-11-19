import type { Services, TempUnit, Thresholds } from "../types";

export interface AssetConfig {
  id: string;
  name: string;
}

export interface SensorConfig {
  id: string;
  name: string;
  assetId: string;
  /** Physical Exertherm Datacard channel, 1-8. Informational only for now. */
  channel: number;
}

/** One monitored HVAC unit. id matches hvac_unit_id in ctm365_hvac_telemetry (the gateway's MQTT topic). */
export interface HvacUnitConfig {
  id: string;
  name: string;
}

export interface CustomerConfig {
  customerId: string;
  siteName: string;
  assets: AssetConfig[];
  sensors: SensorConfig[];
  /** Unit the customer's dashboard shows temperature rise in. Defaults to °F. */
  tempUnit: TempUnit;
  /** Watch/critical boundaries (Celsius rise) applied to every sensor. */
  thresholds: Thresholds;
  hvacUnits: HvacUnitConfig[];
  /** Which services the customer sees. Set on /admin; a service that is off keeps its setup. */
  services: Services;
  /**
   * The Exertherm datacard feeding this customer's electrical sensors: the
   * last part of its gateway's topic, ctm365/<site>/electrical/<datacard-id>.
   * null until one is connected. Sensor channels 1-8 map to its Sensor1-8.
   */
  electricalDatacardId: string | null;
  updatedAt: string;
}
