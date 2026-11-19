"use client";

import { cn } from "@/components/ui/cn";
import type { HealthCategory, HealthLevel, HvacCycle, HvacHealth } from "@/lib/types";

const LEVEL: Record<HealthLevel, { label: string; pill: string; dot: string; rank: number }> = {
  good: { label: "Good", pill: "bg-ok-soft text-ok", dot: "bg-ok", rank: 0 },
  watch: { label: "Watch", pill: "bg-watch-soft text-watch", dot: "bg-watch", rank: 1 },
  elevated: { label: "Elevated", pill: "bg-critical-soft text-critical", dot: "bg-critical/70", rank: 2 },
  action: { label: "Action", pill: "bg-critical text-white", dot: "bg-critical", rank: 3 },
};

const CATEGORY: Record<HealthCategory, string> = {
  cycling: "Cycling",
  electrical: "Electrical",
  airflow: "Airflow",
  capacity: "Capacity",
  refrigerant: "Refrigerant",
  data: "Data",
};

/** How each stop cause is drawn on the timeline. Power problems are blue: not the unit's fault. */
const CAUSE: Record<string, { label: string; color: string }> = {
  normal: { label: "Normal run", color: "bg-ok" },
  running: { label: "Running at last reading", color: "bg-ok/60" },
  "short-cycle": { label: "Short cycle", color: "bg-watch" },
  "start-attempt": { label: "Start attempt", color: "bg-critical" },
  "short-overload": { label: "Overload trip", color: "bg-critical" },
  "short-low-charge": { label: "Low-charge pattern", color: "bg-critical" },
  power: { label: "Stopped by power problem", color: "bg-brand" },
  "meter-power-loss": { label: "Power lost", color: "bg-brand" },
  "data-gap": { label: "Data gap", color: "bg-line" },
};

const timeOf = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Pill({ level, className }: { level: HealthLevel; className?: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", LEVEL[level].pill, className)}>
      {LEVEL[level].label}
    </span>
  );
}

/** Today's compressor runs on a midnight-to-midnight bar, colored by why each one stopped. */
function CycleTimeline({ cycles, dayStart }: { cycles: HvacCycle[]; dayStart: number }) {
  const day = 86_400_000;
  const counts = new Map<string, number>();
  for (const c of cycles) counts.set(c.cause, (counts.get(c.cause) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">Today&apos;s compressor runs</p>
        <p className="text-xs text-muted">{cycles.length} {cycles.length === 1 ? "run" : "runs"}</p>
      </div>
      <div
        className="relative h-6 overflow-hidden rounded bg-sunken"
        role="img"
        aria-label={`${cycles.length} compressor runs today: ${[...counts].map(([k, n]) => `${n} ${CAUSE[k]?.label ?? k}`).join(", ")}`}
      >
        {cycles.map((c) => {
          const left = Math.max(0, ((c.start - dayStart) / day) * 100);
          const width = Math.max(0.25, ((c.end - c.start) / day) * 100);
          return (
            <span
              key={c.start}
              title={`${timeOf(c.start)}–${timeOf(c.end)} · ${c.runMin} min · ${CAUSE[c.cause]?.label ?? c.cause}. ${c.detail}`}
              className={cn("absolute inset-y-0", CAUSE[c.cause]?.color ?? "bg-muted")}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted" aria-hidden>
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
      {counts.size > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {[...counts].map(([cause, n]) => (
            <li key={cause} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-sm", CAUSE[cause]?.color ?? "bg-muted")} />
              {n} {CAUSE[cause]?.label ?? cause}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MEASURES = [
  { key: "slt", label: "Suction line", unit: "°F", digits: 0 },
  { key: "dlt", label: "Discharge line", unit: "°F", digits: 0 },
  { key: "kw", label: "Unit power", unit: "kW", digits: 2 },
  { key: "dt", label: "Air ΔT", unit: "°F", digits: 0 },
] as const;

/** Daily low-charge pattern strength as a small line; a steady rise is what a slow leak looks like. */
function ChargeTrend({ points }: { points: { day: string; value: number }[] }) {
  if (points.length < 2) return null;
  const w = 160;
  const h = 36;
  const values = points.map((p) => p.value);
  const lo = Math.min(-1, ...values);
  const hi = Math.max(3, ...values);
  const x = (i: number) => (i / (points.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <div className="flex items-center gap-3">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Charge pattern over ${points.length} days, latest ${last.value.toFixed(1)}`}>
        <line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="var(--color-line)" strokeDasharray="2 3" />
        <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth="1.75" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="2.5" fill="var(--color-brand)" />
      </svg>
      <p className="text-xs text-muted">
        Low-charge pattern, last {points.length} days. Flat near zero is healthy; a steady climb is what a slow leak looks like.
      </p>
    </div>
  );
}

/**
 * Refrigerant side from the strap-on line probes, compared like Thalo's
 * Sidekick: today's typical readings against what this unit normally reads at
 * the same outdoor temperature.
 */
function RefrigerantBlock({ health }: { health: HvacHealth }) {
  const r = health.refrigerant;
  const { refrigerantSamples, refrigerantModel, refrigerantConfidence } = health.baseline;

  if (!r) {
    if (refrigerantSamples > 0 && !refrigerantModel) {
      const pct = Math.min(99, Math.round((refrigerantSamples / 60) * 100));
      return (
        <p className="text-xs text-muted">
          Refrigerant analysis: line probes are reporting. Comparisons start after about 3 hours of compressor running ({pct}% there).
        </p>
      );
    }
    if (!refrigerantModel) {
      return (
        <p className="text-xs text-muted">
          Refrigerant analysis starts when suction line, discharge line and outdoor air probes are fitted.
        </p>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">Refrigerant side, today vs normal</p>
        <p className="text-xs text-muted">
          At {Math.round(r.outdoorF)}°F outdoors · {refrigerantConfidence ?? "low"} confidence
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {MEASURES.map((m) => {
          const v = r.actual[m.key];
          const [lo, hi] = r.range[m.key];
          const out = v < lo || v > hi;
          return (
            <div key={m.key}>
              <dt className="text-xs text-muted">{m.label}</dt>
              <dd className={cn("tabular text-lg font-semibold", out ? "text-watch" : "text-ink")}>
                {v.toFixed(m.digits)}
                <span className="ml-0.5 text-xs font-medium text-muted">{m.unit}</span>
              </dd>
              <dd className="tabular text-xs text-muted">
                normal {lo.toFixed(m.digits)}–{hi.toFixed(m.digits)}
              </dd>
            </div>
          );
        })}
      </dl>
      <ChargeTrend points={health.chargeHistory} />
    </div>
  );
}

/**
 * Health for one HVAC unit: overall status and score, a status per category,
 * what was found and what to do, and today's runs.
 */
export function HvacHealthPanel({ health }: { health: HvacHealth | undefined | null }) {
  if (health === null) return null; // still loading
  if (!health) {
    return (
      <div className="border-b border-line px-5 py-4 text-sm text-muted">
        Health checks run every hour. This unit&apos;s first results will appear after the next run.
      </div>
    );
  }

  const findings = [...health.findings].sort((a, b) => LEVEL[b.level].rank - LEVEL[a.level].rank);
  const { baseline } = health;

  return (
    <section aria-label="Unit health" className="flex flex-col gap-4 border-b border-line px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <Pill level={health.status} className="px-3 py-1 text-sm" />
          <p className="tabular font-display text-2xl font-semibold text-ink">
            {health.score}
            <span className="text-sm font-medium text-muted">/100</span>
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Health by area">
          {(Object.keys(CATEGORY) as HealthCategory[]).map((c) => (
            <li key={c} className="flex items-center gap-1.5 text-sm text-muted" title={LEVEL[health.categories?.[c] ?? "good"].label}>
              <span aria-hidden className={cn("size-2 rounded-full", LEVEL[health.categories?.[c] ?? "good"].dot)} />
              {CATEGORY[c]}
              <span className="sr-only">: {LEVEL[health.categories?.[c] ?? "good"].label}</span>
            </li>
          ))}
        </ul>
        <p className="ml-auto text-xs text-muted">Checked {timeOf(Date.parse(health.computedAt))}</p>
      </div>

      {findings.length === 0 ? (
        <p className="text-sm text-ok">No issues found today.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {findings.map((f) => (
            <li key={`${f.code}-${f.category}`} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill level={f.level} />
                <span className="text-sm font-medium text-ink">{f.title}</span>
                <span className="text-xs text-muted">· {CATEGORY[f.category] ?? f.category}</span>
              </div>
              <p className="text-sm text-muted">{f.detail}</p>
              <p className="text-sm text-ink">
                <span className="font-medium">What to do:</span> {f.action}
              </p>
            </li>
          ))}
        </ul>
      )}

      <CycleTimeline cycles={health.cycles} dayStart={health.dayStart} />

      <RefrigerantBlock health={health} />

      <p className="text-xs text-muted">
        {baseline.ready
          ? `Compared against this unit's own normal, learned from ${baseline.days} ${baseline.days === 1 ? "day" : "days"} of running (${baseline.confidence ?? "low"} confidence). It keeps learning, so comparisons sharpen as data comes in.`
          : `Cycle, power, voltage and limit checks are running now. Comparisons with this unit's own normal start after its first full day of running${baseline.resetAt ? ` (learning restarted ${baseline.resetAt})` : ""}.`}
      </p>
    </section>
  );
}
