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

      <p className="text-xs text-muted">
        {baseline.ready
          ? "Compared against this unit's own normal operation."
          : `Learning this unit's normal operation: ${Math.min(baseline.days, baseline.needed)} of ${baseline.needed} days with enough runtime${baseline.resetAt ? ` (restarted ${baseline.resetAt})` : ""}. Until then, only fixed limits are checked.`}{" "}
        {!baseline.refrigerantModel &&
          "Refrigerant pattern checks start once suction, discharge and outdoor probes are fitted and learned."}
      </p>
    </section>
  );
}
