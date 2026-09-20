"use client";

import { useLiveFleet } from "@/lib/live-fleet";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatRise } from "./format";
import { Sparkline } from "./sparkline";

export function AssetTable() {
  const { site, sensors, selected, select } = useLiveFleet();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assets</CardTitle>
        <span className="text-xs text-muted">Temperature rise above ambient</span>
      </CardHeader>
      <Table>
        <THead>
          <tr>
            <TH>Sensor</TH>
            <TH className="text-right">Rise</TH>
            <TH>Trend</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        {site.assets.map((asset) => (
          <TBody key={asset.id}>
            <TR>
              <th scope="rowgroup" colSpan={4} className="bg-sunken px-5 py-2 text-left text-sm font-semibold text-ink">
                {asset.name}
              </th>
            </TR>
            {sensors
              .filter((s) => s.assetId === asset.id)
              .map((s) => {
                const isSelected = selected?.id === s.id;
                return (
                  <TR
                    key={s.id}
                    className={cn("cursor-pointer hover:bg-sunken", isSelected && "bg-brand-soft hover:bg-brand-soft")}
                    onClick={() => select(s.id)}
                  >
                    <TD>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          select(s.id);
                        }}
                        aria-pressed={isSelected}
                        className="font-medium text-ink"
                      >
                        {s.name}
                      </button>
                      <span className="ml-2 text-xs text-muted">Channel {s.channel}</span>
                    </TD>
                    <TD className="tabular text-right font-display font-medium">{formatRise(s.latest?.deltaC, site.unit)}°{site.unit}</TD>
                    <TD>
                      <Sparkline history={s.history} status={s.status} />
                    </TD>
                    <TD>
                      <StatusBadge status={s.status} />
                    </TD>
                  </TR>
                );
              })}
          </TBody>
        ))}
      </Table>
    </Card>
  );
}
