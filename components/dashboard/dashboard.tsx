"use client";

import { useLiveFleet } from "@/lib/live-fleet";
import { Card } from "@/components/ui/card";
import { AnnunciatorStrip } from "./annunciator-strip";
import { AssetTable } from "./asset-table";
import { AttentionHero } from "./attention-hero";
import { SensorDetail } from "./sensor-detail";
import { SiteHeader } from "./site-header";

export function Dashboard({ userEmail, showAdminLink }: { userEmail: string; showAdminLink: boolean }) {
  const { site, connection, lastUpdate } = useLiveFleet();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        connection={connection}
        lastUpdate={lastUpdate}
        userEmail={userEmail}
        showAdminLink={showAdminLink}
      />
      {site.sensors.length === 0 ? (
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
          <Card className="flex min-h-[320px] flex-col items-center justify-center gap-2 p-6 text-center">
            <h1 className="font-display text-lg font-semibold text-ink">No sensors configured yet</h1>
            <p className="max-w-prose text-sm text-muted">
              Your site&apos;s assets and sensors haven&apos;t been set up. Contact your CTM365 administrator.
            </p>
          </Card>
        </main>
      ) : (
        <>
          <AnnunciatorStrip />
          <main className="mx-auto grid w-full max-w-[1400px] flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <AttentionHero />
              <AssetTable />
            </div>
            <SensorDetail />
          </main>
        </>
      )}
    </div>
  );
}
