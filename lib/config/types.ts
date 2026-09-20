import type { TempUnit, Thresholds } from "../types";

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

export interface CustomerConfig {
  customerId: string;
  siteName: string;
  assets: AssetConfig[];
  sensors: SensorConfig[];
  /** Unit the customer's dashboard shows temperature rise in. Defaults to °F. */
  tempUnit: TempUnit;
  /** Watch/critical boundaries (Celsius rise) applied to every sensor. */
  thresholds: Thresholds;
  updatedAt: string;
}
