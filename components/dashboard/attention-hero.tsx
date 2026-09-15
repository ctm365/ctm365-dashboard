"use client";

import { useLiveFleet } from "@/lib/live-fleet";
import { cn } from "@/components/ui/cn";

export function AttentionHero() {
  const { sensors, connection } = useLiveFleet();
  const critical = sensors.filter((s) => s.status === "critical").length;
  const watch = sensors.filter((s) => s.status === "watch").length;
  const attention = critical + watch;
  const loading = connection === "connecting";
  const tone = loading ? "text-muted" : critical > 0 ? "text-critical" : attention > 0 ? "text-watch" : "text-ok";

  return (
    <section aria-live="polite" className="py-2">
      {loading ? (
        <p className={cn("font-display text-4xl font-semibold tracking-tight", tone)}>Waiting for readings</p>
      ) : attention === 0 ? (
        <p className={cn("font-display text-4xl font-semibold tracking-tight sm:text-5xl", tone)}>All sensors normal</p>
      ) : (
        <p className={cn("font-display font-semibold tracking-tight", tone)}>
          <span className="tabular block text-8xl leading-none sm:text-9xl">{attention}</span>
          <span className="mt-2 block text-3xl leading-tight sm:text-4xl">
            {attention === 1 ? "sensor needs attention" : "sensors need attention"}
          </span>
        </p>
      )}
      {!loading && (
        <p className="mt-3 max-w-prose text-sm text-muted">
          {critical} critical, {watch} on watch, {sensors.length - attention} normal across {sensors.length} sensors.
        </p>
      )}
    </section>
  );
}
