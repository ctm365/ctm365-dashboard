"use client";

import type { ConnectionState } from "@/lib/live-fleet";
import { useLiveFleet } from "@/lib/live-fleet";
import { cn } from "@/components/ui/cn";
import { formatTime } from "./format";

const CONNECTION_TEXT: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
};

/** Live-stream state for the Electrical page header. */
export function ConnectionStatus() {
  const { connection, lastUpdate, stale } = useLiveFleet();
  // The stream can be connected while the datacard has gone quiet.
  const quiet = connection === "live" && stale;
  return (
    <div className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          quiet ? "bg-watch" : connection === "live" ? "bg-ok" : connection === "reconnecting" ? "bg-watch" : "bg-line",
        )}
      />
      <span className="mr-2">{quiet ? "No recent data" : CONNECTION_TEXT[connection]}</span>
      {lastUpdate && <span className="tabular hidden sm:inline">Last reading {formatTime(lastUpdate)}</span>}
    </div>
  );
}
