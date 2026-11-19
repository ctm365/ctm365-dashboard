"use client";

import { useLiveFleet } from "@/lib/live-fleet";
import { AnnunciatorStrip } from "./annunciator-strip";
import { AssetTable } from "./asset-table";
import { AttentionHero } from "./attention-hero";
import { EmptyState } from "./empty-state";
import { SensorDetail } from "./sensor-detail";

/** Body of the Electrical page. Must sit inside LiveFleetProvider. */
export function ElectricalDashboard() {
  const { site } = useLiveFleet();

  if (!site.electricalDatacardId && !site.electricalSampleData) {
    return (
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
        <EmptyState title="Your monitoring equipment isn't connected yet">
          Once your site&apos;s datacard is connected, live temperature readings will appear here. Contact your
          CTM365 administrator if you expected to see data.
        </EmptyState>
      </main>
    );
  }

  if (site.sensors.length === 0) {
    return (
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
        <EmptyState title="No sensors configured yet">
          Your site&apos;s electrical assets and sensors haven&apos;t been set up. Contact your CTM365 administrator.
        </EmptyState>
      </main>
    );
  }

  return (
    <>
      <AnnunciatorStrip />
      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <AttentionHero />
            <AssetTable />
          </div>
          <SensorDetail />
        </div>
      </main>
    </>
  );
}
