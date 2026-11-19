"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { imbalancePct } from "@/lib/sample-power";
import type { PowerReading } from "@/lib/types";
import { timeLabel, TrendChart } from "./hvac-section";

/**
 * The electrical panel's per-phase voltage and current, from its WattNode
 * (or the demo panel in sample-data mode). Polls /api/electrical/power every
 * minute, matching the meter's reporting interval. Each half shows only when
 * switched on for the customer on the admin page.
 */

const POLL_MS = 60_000;

/** US 208Y/120 V wire colors: phase A black, B red, C blue. */
const PHASES = [
  { key: "A", color: "var(--color-ink)" },
  { key: "B", color: "var(--color-critical)" },
  { key: "C", color: "var(--color-brand)" },
] as const;

interface PowerView {
  showVoltage: boolean;
  showCurrent: boolean;
  sample: boolean;
  connected: boolean;
  readings: PowerReading[];
}

const fmt = (v: number | undefined, d = 1) => (v === undefined ? "–" : v.toFixed(d));

function latest<K extends keyof PowerReading>(rows: PowerReading[], key: K): number | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

function ImbalanceNote({ pct, limit }: { pct: number | undefined; limit: number }) {
  if (pct === undefined) return null;
  const high = pct > limit;
  return (
    <p className={cn("text-xs", high ? "font-medium text-watch" : "text-muted")}>
      Imbalance {pct.toFixed(1)}%{high ? ` (above ${limit}%: check loads and connections)` : ""}
    </p>
  );
}

function PhaseTiles({ label, unit, values }: { label: string; unit: string; values: { name: string; value: number | undefined; color: string }[] }) {
  return (
    <dl className="grid grid-cols-3 gap-px bg-line">
      {values.map((v) => (
        <div key={v.name} className="bg-surface px-5 py-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted">
            <span aria-hidden className="size-2 rounded-full" style={{ background: v.color }} />
            {label} {v.name}
          </dt>
          <dd className="tabular font-display text-2xl font-semibold leading-tight text-ink">
            {fmt(v.value)}
            {v.value !== undefined && <span className="ml-1 text-sm font-medium text-muted">{unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PowerSection() {
  const [view, setView] = useState<PowerView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/electrical/power", { cache: "no-store" });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (res.status === 403) {
        setView(null);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as PowerView);
      setError(null);
    } catch {
      setError("Couldn't load voltage and current. Retrying every minute.");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const rows = useMemo(() => view?.readings ?? [], [view]);
  // Line-to-neutral when the panel has a neutral (most 208Y/120 panels); otherwise line-to-line.
  const hasNeutral = rows.some((r) => r.voltsAN !== undefined && r.voltsAN > 0);
  const voltKeys = hasNeutral
    ? ([["A-N", "voltsAN"], ["B-N", "voltsBN"], ["C-N", "voltsCN"]] as const)
    : ([["A-B", "voltsAB"], ["B-C", "voltsBC"], ["C-A", "voltsCA"]] as const);
  const ampKeys = [["A", "ampsA"], ["B", "ampsB"], ["C", "ampsC"]] as const;

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        ts: r.ts,
        vA: hasNeutral ? r.voltsAN : r.voltsAB,
        vB: hasNeutral ? r.voltsBN : r.voltsBC,
        vC: hasNeutral ? r.voltsCN : r.voltsCA,
        aA: r.ampsA,
        aB: r.ampsB,
        aC: r.ampsC,
      })),
    [rows, hasNeutral],
  );

  if (!view) {
    return error ? (
      <p role="alert" className="rounded-md bg-watch-soft px-4 py-2 text-sm text-watch">
        {error}
      </p>
    ) : null;
  }

  const last = rows.at(-1);
  const volts = voltKeys.map(([name, key], i) => ({ name, value: latest(rows, key), color: PHASES[i].color }));
  const amps = ampKeys.map(([name, key], i) => ({ name, value: latest(rows, key), color: PHASES[i].color }));
  const voltImbalance = imbalancePct(volts.map((v) => v.value));
  const ampImbalance = imbalancePct(amps.map((a) => a.value));
  const stale = last ? Date.now() - last.ts > 5 * 60_000 : true;

  return (
    <section aria-labelledby="power-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="power-heading" className="font-display text-xl font-semibold text-ink">
            Panel power
          </h2>
          <p className="text-sm text-muted">Voltage and current per phase, updated every minute.</p>
        </div>
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className={cn("size-2 rounded-full", view.sample ? "bg-brand" : !view.connected || stale ? "bg-watch" : "bg-ok")} />
          {view.sample
            ? "Sample data"
            : !view.connected
              ? "Meter not connected"
              : last
                ? `${stale ? "No recent data · last" : "Last"} reading ${timeLabel(last.ts, false)}`
                : "Waiting for readings"}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-watch-soft px-4 py-2 text-sm text-watch">
          {error}
        </p>
      )}

      {!view.connected ? (
        <Card className="px-5 py-6 text-center text-sm text-muted">
          The panel&apos;s power meter isn&apos;t connected yet. Voltage and current will appear here once it is.
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {view.showVoltage && (
            <Card className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
                <h3 className="font-display text-base font-semibold text-ink">Voltage</h3>
                {/* Voltage imbalance over ~3% overheats motors on the panel (ANSI C84.1 / NEMA MG-1 guidance). */}
                <ImbalanceNote pct={voltImbalance} limit={3} />
              </div>
              <PhaseTiles label="" unit="V" values={volts} />
              <TrendChart
                title={hasNeutral ? "Line-to-neutral voltage" : "Line-to-line voltage"}
                data={chartData}
                withDate={false}
                unit="V"
                digits={1}
                series={PHASES.map((p, i) => ({ key: `v${p.key}`, label: voltKeys[i][0], color: p.color }))}
              />
            </Card>
          )}
          {view.showCurrent && (
            <Card className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
                <h3 className="font-display text-base font-semibold text-ink">Current</h3>
                {/* Across a whole building panel some imbalance is normal; over ~20% usually means loads need rebalancing. */}
                <ImbalanceNote pct={ampImbalance} limit={20} />
              </div>
              <PhaseTiles label="Phase" unit="A" values={amps} />
              <TrendChart
                title="Current per phase"
                data={chartData}
                withDate={false}
                unit="A"
                digits={1}
                series={PHASES.map((p) => ({ key: `a${p.key}`, label: `Phase ${p.key}`, color: p.color }))}
              />
            </Card>
          )}
        </div>
      )}
    </section>
  );
}
