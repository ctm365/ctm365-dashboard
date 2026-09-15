"use client";

import { useLiveFleet } from "@/lib/live-fleet";
import { AnnunciatorStrip } from "./annunciator-strip";
import { AssetTable } from "./asset-table";
import { AttentionHero } from "./attention-hero";
import { SensorDetail } from "./sensor-detail";
import { SiteHeader } from "./site-header";

export function Dashboard() {
  const { connection, lastUpdate } = useLiveFleet();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader connection={connection} lastUpdate={lastUpdate} />
      <AnnunciatorStrip />
      <main className="mx-auto grid w-full max-w-[1400px] flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <AttentionHero />
          <AssetTable />
        </div>
        <SensorDetail />
      </main>
    </div>
  );
}
