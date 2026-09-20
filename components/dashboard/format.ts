import { convertRise } from "@/lib/fleet";
import type { TempUnit } from "@/lib/types";

/** A stored Celsius rise, converted to the customer's unit. The caller adds the °F/°C label. */
export const formatRise = (deltaC: number | undefined | null, unit: TempUnit, digits = 1) =>
  deltaC == null ? "–" : convertRise(deltaC, unit).toFixed(digits);

/** For threshold labels: at most one decimal, no trailing ".0". */
export const formatLimit = (deltaC: number, unit: TempUnit) => String(Math.round(convertRise(deltaC, unit) * 10) / 10);

export const unitName = (unit: TempUnit) => (unit === "F" ? "Fahrenheit" : "Celsius");

export const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
