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

/** The monitoring services CTM365 offers. A customer can have either or both. */
export type ServiceId = "electrical" | "hvac";

/** Which services a customer has. A service that is off is hidden from them entirely. */
export type Services = Record<ServiceId, boolean>;

export interface HvacUnitDef {
  /** hvac_unit_id in ctm365_hvac_telemetry. */
  id: string;
  name: string;
}

export interface SiteDef {
  id: string;
  name: string;
  assets: AssetDef[];
  sensors: SensorDef[];
  /** Set per customer on /admin. */
  unit: TempUnit;
  thresholds: Thresholds;
  hvacUnits: HvacUnitDef[];
  services: Services;
  /** Exertherm datacard whose readings feed the electrical sensors, or null if none is connected yet. */
  electricalDatacardId: string | null;
  /** Show the fixed sample scenario on the Electrical page instead of live readings (for demos). */
  electricalSampleData: boolean;
  /** WattNode on the electrical panel (topic ctm365/<site>/power/<meter-id>), or null. */
  electricalPowerMeterId: string | null;
  /** Show the panel's per-phase voltage / current on the Electrical page. */
  showVoltage: boolean;
  showCurrent: boolean;
  /** HVAC page shows the sample heat pump instead of live readings (demos, or while equipment is offline). */
  hvacSampleData: boolean;
}

/** One minute of electrical-panel power readings. Any field can be missing. */
export interface PowerReading {
  ts: number;
  /** Line-to-neutral volts per phase, when the panel has a neutral. */
  voltsAN?: number;
  voltsBN?: number;
  voltsCN?: number;
  /** Line-to-line volts. */
  voltsAB?: number;
  voltsBC?: number;
  voltsCA?: number;
  ampsA?: number;
  ampsB?: number;
  ampsC?: number;
}

/**
 * One minute of HVAC readings from ctm365_hvac_telemetry (already converted
 * to engineering units by the ctm365-hvac-ingest Lambda). Any field can be
 * missing when a device didn't answer that minute.
 */
export interface HvacReading {
  /** Start of the minute, epoch milliseconds. */
  ts: number;
  supplyF?: number;
  returnF?: number;
  staticInwc?: number;
  voltageV?: number;
  voltageAnV?: number;
  voltageAbV?: number;
  currentA?: number;
  currentAA?: number;
  currentBA?: number;
  currentCA?: number;
  powerW?: number;
  powerFactor?: number;
  frequencyHz?: number;
  energyKwh?: number;
  /** Strap-on refrigerant line probes and outdoor air (optional add-ons). */
  suctionLineF?: number;
  dischargeLineF?: number;
  liquidLineF?: number;
  outdoorF?: number;
}

export interface HvacUnitData {
  id: string;
  name: string;
  /** Oldest first. */
  readings: HvacReading[];
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

/** HVAC health from the hourly analytics job (ctm365_hvac_analytics). */
export type HealthLevel = "good" | "watch" | "elevated" | "action";
export type HealthCategory = "cycling" | "electrical" | "airflow" | "capacity" | "refrigerant" | "data";

export interface HvacFinding {
  category: HealthCategory;
  level: HealthLevel;
  code: string;
  title: string;
  detail: string;
  action: string;
}

/** One compressor run, and why it stopped. */
export interface HvacCycle {
  start: number;
  end: number;
  runMin: number;
  cause: string;
  detail: string;
}

export interface HvacHealth {
  unitId: string;
  status: HealthLevel;
  score: number;
  categories: Record<HealthCategory, HealthLevel>;
  findings: HvacFinding[];
  /** The unit's learned normal. It keeps learning; confidence grows with days of data. */
  baseline: {
    ready: boolean;
    days: number;
    confidence?: "low" | "medium" | "high";
    refrigerantModel: boolean;
    refrigerantConfidence?: "low" | "medium" | "high";
    /** Settled running samples seen with line probes (about 60 = 3 hours starts the comparison). */
    refrigerantSamples: number;
    resetAt?: string;
  };
  /** Today's typical refrigerant readings vs this unit's normal, when line probes are fitted. */
  refrigerant?: {
    actual: Record<"slt" | "dlt" | "kw" | "dt", number>;
    expected: Record<"slt" | "dlt" | "kw" | "dt", number>;
    range: Record<"slt" | "dlt" | "kw" | "dt", [number, number]>;
    outdoorF: number;
    chargeIndex: number;
  };
  /** Daily low-charge pattern strength for the last two weeks, oldest first (a slow leak rises). */
  chargeHistory: { day: string; value: number }[];
  computedAt: string;
  /** Start of today in the site's time zone (epoch ms), for the cycle timeline. */
  dayStart: number;
  cycles: HvacCycle[];
}
