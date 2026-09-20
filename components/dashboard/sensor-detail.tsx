"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { convertRise } from "@/lib/fleet";
import { useLiveFleet } from "@/lib/live-fleet";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

const EDGE = { normal: "border-t-ok", watch: "border-t-watch", critical: "border-t-critical" } as const;
import { formatLimit, formatRise, formatTime } from "./format";

export function SensorDetail() {
  const { selected, site } = useLiveFleet();
  const { unit, thresholds } = site;

  const data = useMemo(
    () => (selected?.history ?? []).map((r) => ({ ts: r.ts, rise: Math.round(convertRise(r.deltaC, unit) * 10) / 10 })),
    [selected?.history, unit],
  );

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const values = data.map((d) => d.rise);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
    };
  }, [data]);

  if (!selected) {
    return (
      <Card className="flex min-h-[420px] items-center justify-center p-6 text-sm text-muted">
        Select a sensor to see its trend.
      </Card>
    );
  }

  const asset = site.assets.find((a) => a.id === selected.assetId);
  const watchLimit = convertRise(thresholds.watchC, unit);
  const criticalLimit = convertRise(thresholds.criticalC, unit);
  // Headroom above the critical line is 8°F (about 4.4°C) so the line never hugs the top edge.
  const headroom = unit === "F" ? 8 : 4.5;
  const yMax = Math.ceil(Math.max(criticalLimit + headroom, stats?.max ?? 0) / 5) * 5;

  return (
    <Card className={cn("flex min-w-0 flex-col border-t-4 lg:sticky lg:top-6 lg:self-start", EDGE[selected.status])}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">{selected.name}</h2>
          <p className="text-sm text-muted">
            {asset?.name}, channel {selected.channel}
          </p>
        </div>
        <div className="text-right">
          <p
            className={cn(
              "tabular font-display text-5xl font-semibold leading-none",
              selected.status === "critical" ? "text-critical" : selected.status === "watch" ? "text-watch" : "text-ink",
            )}
          >
            {formatRise(selected.latest?.deltaC, unit)}
            <span className="ml-1 text-xl font-medium text-muted">°{unit}</span>
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <StatusBadge status={selected.status} />
            {selected.latest && <span className="tabular text-xs text-muted">{formatTime(selected.latest.ts)}</span>}
          </div>
        </div>
      </div>

      <div className="h-[340px] px-2 pt-4" role="img" aria-label={`Temperature rise trend for ${selected.name}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 56, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              tick={{ fontSize: 12, fill: "var(--color-muted)" }}
              stroke="var(--color-line)"
              minTickGap={48}
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fontSize: 12, fill: "var(--color-muted)" }}
              stroke="var(--color-line)"
              width={44}
              tickFormatter={(v: number) => `${v}°`}
            />
            <ReferenceLine
              y={watchLimit}
              stroke="var(--color-watch)"
              strokeDasharray="6 4"
              label={{ value: "Watch", position: "right", fill: "var(--color-watch)", fontSize: 12 }}
            />
            <ReferenceLine
              y={criticalLimit}
              stroke="var(--color-critical)"
              strokeDasharray="6 4"
              label={{ value: "Critical", position: "right", fill: "var(--color-critical)", fontSize: 12 }}
            />
            <Tooltip
              labelFormatter={(ts) => formatTime(Number(ts))}
              formatter={(v) => [`${Number(v).toFixed(1)}°${unit}`, "Rise"]}
              contentStyle={{ borderRadius: 6, borderColor: "var(--color-line)", fontSize: 13 }}
            />
            <Line
              type="monotone"
              dataKey="rise"
              stroke="var(--color-brand)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {stats && (
        <dl className="grid grid-cols-3 border-t border-line text-sm">
          {[
            ["Lowest", stats.min],
            ["Average", stats.avg],
            ["Highest", stats.max],
          ].map(([label, value]) => (
            <div key={label as string} className="px-5 py-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="tabular font-display text-lg font-medium">{(value as number).toFixed(1)}°{unit}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="px-5 pb-4 text-xs text-muted">
        Last {Math.round((data.length * 2) / 60)} minutes. Watch at {formatLimit(thresholds.watchC, unit)}°{unit} rise,
        critical at {formatLimit(thresholds.criticalC, unit)}°{unit}.
      </p>
    </Card>
  );
}
