export type Status = "normal" | "watch" | "critical";

export interface SensorDef {
  id: string;
  name: string;
  assetId: string;
  /** Physical channel on the Exertherm Datacard (1-8). */
  channel: number;
}

export interface AssetDef {
  id: string;
  name: string;
}

/** Unit the customer's dashboard shows temperature rise in. Readings are always stored in Celsius. */
export type TempUnit = "F" | "C";

export interface SiteDef {
  id: string;
  name: string;
  assets: AssetDef[];
  sensors: SensorDef[];
  /** Set per customer on /admin. */
  unit: TempUnit;
  thresholds: Thresholds;
}

/** One reading. Stored in Celsius, matching temperature_rise_c in DynamoDB. */
export interface Reading {
  sensorId: string;
  /** Epoch milliseconds. */
  ts: number;
  deltaC: number;
}

/**
 * Alert boundaries as temperature rise above ambient, in Celsius (the unit
 * readings are stored in). Below watchC is normal (green), from watchC up to
 * criticalC is watch (yellow), criticalC and above is critical (red). One
 * pair applies to every sensor for a customer.
 */
export interface Thresholds {
  watchC: number;
  criticalC: number;
}
