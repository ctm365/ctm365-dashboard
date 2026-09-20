"use client";

import { useLiveFleet } from "@/lib/live-fleet";
import type { Status } from "@/lib/types";
import { cn } from "@/components/ui/cn";
import { formatRise, unitName } from "./format";

/**
 * Modeled on a physical annunciator panel: a dark rail of individually lit
 * windows, rather than a row of colored stat pills.
 */
const LAMP: Record<Status, string> = {
  normal: "bg-ok",
  watch: "bg-watch shadow-[0_0_8px_var(--color-watch)]",
  critical: "bg-critical lamp-critical",
};

const TILE: Record<Status, string> = {
  normal: "border-white/10",
  watch: "border-watch/40",
  critical: "border-critical/60",
};

export function AnnunciatorStrip() {
  const { sensors, selected, select, site } = useLiveFleet();

  return (
    <nav aria-label="Sensor status panel" className="border-b border-line bg-ink">
      <div className="mx-auto flex max-w-[1400px] gap-2 overflow-x-auto px-4 py-3 sm:px-6">
        {sensors.map((s) => {
          const asset = site.assets.find((a) => a.id === s.assetId);
          const isSelected = selected?.id === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              aria-pressed={isSelected}
              aria-label={`${s.name}, ${asset?.name ?? ""}, ${s.status}, ${formatRise(s.latest?.deltaC, site.unit)} degrees ${unitName(site.unit)} rise`}
              className={cn(
                "flex min-w-[132px] flex-1 items-center gap-2.5 rounded-sm border bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]",
                TILE[s.status],
                isSelected && "bg-white/10 ring-1 ring-inset ring-brand",
              )}
            >
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", LAMP[s.status])} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium text-white/65">{s.name}</span>
                <span className="tabular font-display text-lg font-semibold leading-tight text-white">
                  {formatRise(s.latest?.deltaC, site.unit)}°{site.unit}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
