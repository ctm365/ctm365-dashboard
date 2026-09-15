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

export interface SiteDef {
  id: string;
  name: string;
  assets: AssetDef[];
  sensors: SensorDef[];
}

/** One reading. Stored in Celsius, matching temperature_rise_c in DynamoDB. */
export interface Reading {
  sensorId: string;
  /** Epoch milliseconds. */
  ts: number;
  deltaC: number;
}

export interface Thresholds {
  /** Temperature rise (°F) at which a sensor is on watch. */
  watchF: number;
  /** Temperature rise (°F) at which a sensor is critical. */
  criticalF: number;
}
