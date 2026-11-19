"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HvacHealth, HvacReading, HvacUnitData, HvacUnitDef } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { HvacHealthPanel } from "./hvac-health-panel";

/**
 * HVAC monitoring: one card per unit with live readouts and trends.
 * Data comes from /api/hvac (DynamoDB ctm365_hvac_telemetry, one row per
 * minute), polled every minute to match the gateway's publish interval.
 */

const POLL_MS = 60_000;
const RANGES = [
  { hours: 6, label: "6 h" },
  { hours: 24, label: "24 h" },
  { hours: 168, label: "7 days" },
] as const;

type Freshness = "online" | "delayed" | "offline" | "none";

const FRESHNESS: Record<Freshness, { label: string; dot: string; text: string }> = {
  online: { label: "Online", dot: "bg-ok", text: "text-ok" },
  delayed: { label: "Delayed", dot: "bg-watch", text: "text-watch" },
  offline: { label: "Offline", dot: "bg-critical", text: "text-critical" },
  none: { label: "No data yet", dot: "bg-line", text: "text-muted" },
};

function freshness(last: HvacReading | undefined, now: number): Freshness {
  if (!last) return "none";
  // ts is the start of the minute the reading belongs to.
  const age = now - (last.ts + 60_000);
  if (age <= 3 * 60_000) return "online";
  if (age <= 15 * 60_000) return "delayed";
  return "offline";
}

/** Most recent non-missing value of a field. */
function latest<K extends keyof HvacReading>(readings: HvacReading[], key: K): number | undefined {
  for (let i = readings.length - 1; i >= 0; i--) {
    const v = readings[i][key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

const fmt = (v: number | undefined, digits: number) => (v == null ? "–" : v.toFixed(digits));

function modeFor(deltaF: number | undefined, amps: number | undefined) {
  if (amps != null && amps < 0.5) return "Off";
  if (deltaF == null) return "–";
  if (deltaF >= 3) return "Cooling";
  if (deltaF <= -3) return "Heating";
  return "Fan / idle";
}

export function timeLabel(ts: number, withDate: boolean) {
  return new Date(ts).toLocaleString([], withDate
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { hour: "numeric", minute: "2-digit" });
}

export function HvacSection({ units }: { units: HvacUnitDef[] }) {
  const [hours, setHours] = useState<number>(24);
  const [data, setData] = useState<HvacUnitData[] | null>(null);
  /** null while loading; units without results yet are simply missing. */
  const [health, setHealth] = useState<HvacHealth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hvac?hours=${hours}`, { cache: "no-store" });
      if (res.status === 401) {
        // Session ended: reload so the page re-checks sign-in.
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { units: HvacUnitData[] };
      setData(body.units);
      setError(null);
      // Health is a separate, optional read: if it fails, the readings still show.
      const h = await fetch("/api/hvac/health", { cache: "no-store" }).catch(() => null);
      setHealth(h?.ok ? ((await h.json()) as { units: HvacHealth[] }).units : []);
    } catch {
      setError("Couldn't load HVAC readings. Retrying every minute.");
    } finally {
      setNow(Date.now());
    }
  }, [hours]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (units.length === 0) return null;

  return (
    <section aria-labelledby="hvac-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="hvac-heading" className="font-display text-xl font-semibold text-ink">
            HVAC monitoring
          </h1>
          <p className="text-sm text-muted">Updated every minute from the on-site gateway.</p>
        </div>
        <div role="group" aria-label="Time range" className="inline-flex rounded-md border border-line bg-surface p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              aria-pressed={hours === r.hours}
              onClick={() => setHours(r.hours)}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium transition-colors",
                hours === r.hours ? "bg-brand text-white" : "text-muted hover:text-ink",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-watch-soft px-4 py-2 text-sm text-watch">
          {error}
        </p>
      )}

      {units.map((def) => {
        const unit = data?.find((u) => u.id === def.id);
        const unitHealth = health === null ? null : health.find((h) => h.unitId === def.id);
        return (
          <HvacUnitCard key={def.id} name={def.name} readings={unit?.readings ?? null} hours={hours} now={now} health={unitHealth} />
        );
      })}
    </section>
  );
}

function HvacUnitCard({
  name,
  readings,
  hours,
  now,
  health,
}: {
  name: string;
  readings: HvacReading[] | null;
  hours: number;
  now: number;
  health: HvacHealth | undefined | null;
}) {
  const rows = useMemo(() => readings ?? [], [readings]);
  const last = rows.at(-1);
  const state = readings == null ? "none" : freshness(last, now);
  const fresh = FRESHNESS[state];

  const supply = latest(rows, "supplyF");
  const ret = latest(rows, "returnF");
  const deltaF = supply != null && ret != null ? ret - supply : undefined;
  const amps = latest(rows, "currentA");
  const power = latest(rows, "powerW");

  const tiles: { label: string; value: string; unit: string; hint?: string }[] = [
    { label: "Supply air", value: fmt(supply, 1), unit: "°F" },
    { label: "Return air", value: fmt(ret, 1), unit: "°F" },
    { label: "Air ΔT", value: fmt(deltaF, 1), unit: "°F", hint: "Return minus supply" },
    { label: "Static pressure", value: fmt(latest(rows, "staticInwc"), 3), unit: "in. w.c." },
    { label: "Mode", value: modeFor(deltaF, amps), unit: "" },
    { label: "Voltage", value: fmt(latest(rows, "voltageV"), 1), unit: "V" },
    { label: "Current", value: fmt(amps, 1), unit: "A" },
    { label: "Power", value: fmt(power == null ? undefined : power / 1000, 2), unit: "kW" },
    { label: "Power factor", value: fmt(latest(rows, "powerFactor"), 2), unit: "" },
    { label: "Energy", value: fmt(latest(rows, "energyKwh"), 1), unit: "kWh", hint: "Meter total" },
  ];

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        ts: r.ts,
        supply: r.supplyF,
        ret: r.returnF,
        static: r.staticInwc,
        amps: r.currentA,
        kw: r.powerW == null ? undefined : Math.round(r.powerW / 10) / 100,
      })),
    [rows],
  );
  const withDate = hours > 24;

  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <h3 className="font-display text-lg font-semibold text-ink">{name}</h3>
        <div className="flex items-center gap-2 text-sm" aria-live="polite">
          <span aria-hidden className={cn("size-2 rounded-full", fresh.dot)} />
          <span className={cn("font-medium", fresh.text)}>{fresh.label}</span>
          {last && <span className="tabular text-muted">· {timeLabel(last.ts, true)}</span>}
        </div>
      </div>

      <HvacHealthPanel health={health} />

      {readings == null ? (
        <p className="px-5 py-10 text-center text-sm text-muted">Loading readings…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">No readings in this time range yet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
            {tiles.map((t) => (
              <div key={t.label} className="bg-surface px-5 py-3" title={t.hint}>
                <dt className="text-xs text-muted">{t.label}</dt>
                <dd className="tabular font-display text-2xl font-semibold leading-tight text-ink">
                  {t.value}
                  {t.unit && t.value !== "–" && <span className="ml-1 text-sm font-medium text-muted">{t.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-px bg-line lg:grid-cols-2">
            <TrendChart
              title="Air temperatures"
              data={chartData}
              withDate={withDate}
              unit="°F"
              digits={1}
              series={[
                { key: "supply", label: "Supply", color: "var(--color-brand)" },
                { key: "ret", label: "Return", color: "var(--color-critical)" },
              ]}
            />
            <TrendChart
              title="Static pressure"
              data={chartData}
              withDate={withDate}
              unit="in. w.c."
              digits={3}
              series={[{ key: "static", label: "Static", color: "var(--color-brand)" }]}
            />
            <TrendChart
              title="Current"
              data={chartData}
              withDate={withDate}
              unit="A"
              digits={1}
              series={[{ key: "amps", label: "Current", color: "var(--color-watch)" }]}
            />
            <TrendChart
              title="Power"
              data={chartData}
              withDate={withDate}
              unit="kW"
              digits={2}
              series={[{ key: "kw", label: "Power", color: "var(--color-ok)" }]}
            />
          </div>
        </>
      )}
    </Card>
  );
}

export type ChartRow = { ts: number } & Record<string, number | undefined>;

export function TrendChart({
  title,
  data,
  series,
  unit,
  digits,
  withDate,
}: {
  title: string;
  data: ChartRow[];
  series: { key: string; label: string; color: string }[];
  unit: string;
  digits: number;
  withDate: boolean;
}) {
  return (
    <div className="bg-surface px-3 pb-3 pt-4">
      <p className="px-2 text-sm font-medium text-ink">
        {title} <span className="font-normal text-muted">({unit})</span>
      </p>
      <div className="h-[220px]" role="img" aria-label={`${title} trend`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(ts: number) => timeLabel(ts, withDate)}
              tick={{ fontSize: 12, fill: "var(--color-muted)" }}
              stroke="var(--color-line)"
              minTickGap={48}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 12, fill: "var(--color-muted)" }}
              stroke="var(--color-line)"
              width={52}
              tickFormatter={(v: number) => v.toFixed(digits > 2 ? 2 : digits)}
            />
            <Tooltip
              labelFormatter={(ts) => timeLabel(Number(ts), true)}
              formatter={(v, name) => [`${Number(v).toFixed(digits)} ${unit}`, name]}
              contentStyle={{ borderRadius: 6, borderColor: "var(--color-line)", fontSize: 13 }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
