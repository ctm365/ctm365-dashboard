"use client";

import { useLiveFleet } from "@/lib/live-fleet";
import type { Status } from "@/lib/types";
import { cn } from "@/components/ui/cn";
import { formatF } from "./format";

const WINDOW: Record<Status, string> = {
  normal: "bg-ok-soft text-ok border-ok/25",
  watch: "bg-watch text-white border-watch",
  critical: "annunciate border-critical",
};

/**
 * One lit window per sensor, like an alarm annunciator panel. Normal windows
 * stay quiet; watch windows light up; critical windows flash.
 */
export function AnnunciatorStrip() {
  const { sensors, selected, select, site } = useLiveFleet();

  return (
    <nav aria-label="Sensor status panel" className="border-b border-line bg-sunken">
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
              aria-label={`${s.name}, ${asset?.name ?? ""}, ${s.status}, ${formatF(s.latest?.deltaC)} degrees Fahrenheit rise`}
              className={cn(
                "flex min-w-[132px] flex-1 flex-col items-start rounded-md border px-3 py-2 text-left transition-shadow",
                WINDOW[s.status],
                isSelected && "ring-2 ring-brand ring-offset-2 ring-offset-sunken",
              )}
            >
              <span className="text-xs font-medium opacity-90">{s.name}</span>
              <span className="tabular font-display text-lg font-semibold leading-tight">
                {formatF(s.latest?.deltaC)}°F
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
