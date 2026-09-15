"use client";

import { useMemo } from "react";
import { cToF } from "@/lib/fleet";
import type { Reading, Status } from "@/lib/types";
import { cn } from "@/components/ui/cn";

const STROKE: Record<Status, string> = {
  normal: "var(--color-ok)",
  watch: "var(--color-watch)",
  critical: "var(--color-critical)",
};

/**
 * Minimal inline trend line. Hand-rolled rather than a charting library
 * since many of these render at once on the asset table.
 */
export function Sparkline({
  history,
  status,
  width = 72,
  height = 26,
  className,
}: {
  history: Reading[];
  status: Status;
  width?: number;
  height?: number;
  className?: string;
}) {
  const { line, area } = useMemo(() => {
    if (history.length < 2) return { line: "", area: "" };
    const window = history.slice(-90);
    const values = window.map((r) => cToF(r.deltaC));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = width / (values.length - 1);
    const points = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * (height - 6) - 3;
      return [x, y] as const;
    });
    const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L${width.toFixed(1)},${height} L0,${height} Z`;
    return { line, area };
  }, [history, width, height]);

  if (!line) {
    return <span aria-hidden className={cn("inline-block", className)} style={{ width, height }} />;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block overflow-visible", className)}
      aria-hidden
    >
      <path d={area} fill={STROKE[status]} opacity={0.12} />
      <path d={line} fill="none" stroke={STROKE[status]} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
