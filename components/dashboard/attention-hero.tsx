"use client";

import { useLiveFleet } from "@/lib/live-fleet";
import { cn } from "@/components/ui/cn";

/**
 * Styled as an instrument readout rather than a stat card: dark panel,
 * a left edge in the fleet's current status color, and the count treated
 * like a digital display rather than decoration.
 */
const READOUT = {
  critical: { number: "text-critical-soft", edge: "border-critical", caption: "text-critical-soft/80" },
  watch: { number: "text-watch-soft", edge: "border-watch", caption: "text-watch-soft/80" },
  normal: { number: "text-ok-soft", edge: "border-ok", caption: "text-ok-soft/80" },
} as const;

export function AttentionHero() {
  const { sensors, connection } = useLiveFleet();
  const critical = sensors.filter((s) => s.status === "critical").length;
  const watch = sensors.filter((s) => s.status === "watch").length;
  const attention = critical + watch;
  const loading = connection === "connecting";
  const level = loading ? "normal" : critical > 0 ? "critical" : attention > 0 ? "watch" : "normal";
  const tone = READOUT[level];

  return (
    <section
      aria-live="polite"
      className={cn("rounded-lg border-l-[6px] bg-ink px-6 py-6", tone.edge)}
    >
      <p className={cn("text-xs font-medium", tone.caption)}>Fleet status</p>

      {loading ? (
        <p className="mt-3 font-display text-3xl font-semibold text-white/60">Waiting for readings</p>
      ) : attention === 0 ? (
        <p className={cn("mt-2 font-display text-4xl font-semibold sm:text-5xl", tone.number)}>All sensors normal</p>
      ) : (
        <p className={cn("mt-1 font-display font-semibold leading-none", tone.number)}>
          <span className="tabular block text-7xl sm:text-8xl">{attention}</span>
          <span className="mt-3 block text-2xl leading-tight sm:text-3xl">
            {attention === 1 ? "sensor needs attention" : "sensors need attention"}
          </span>
        </p>
      )}

      {!loading && (
        <p className="mt-4 max-w-prose text-sm text-white/55">
          {critical} critical, {watch} on watch, {sensors.length - attention} normal across {sensors.length} sensors.
        </p>
      )}
    </section>
  );
}
