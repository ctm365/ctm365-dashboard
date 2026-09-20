"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { THRESHOLD_MAX_C } from "@/lib/config/validation";
import { convertRise, riseToC } from "@/lib/fleet";
import type { TempUnit, Thresholds } from "@/lib/types";

const fmt = (n: number) => String(Math.round(n * 10) / 10);

const ROWS = [
  { key: "normal", label: "Normal", color: "Green", swatch: "bg-ok" },
  { key: "watch", label: "Watch", color: "Yellow", swatch: "bg-watch" },
  { key: "critical", label: "Critical", color: "Red", swatch: "bg-critical" },
] as const;

const BOX = "tabular h-8 w-24 rounded-md border px-2 text-sm";

function LimitInput({
  value,
  onChange,
  label,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  invalid: boolean;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(BOX, "border-line bg-surface text-ink", invalid && "border-critical")}
    />
  );
}

/** A range end that can't be edited (Normal starts at zero; Critical has no upper limit). */
function FixedLimit({ children }: { children: ReactNode }) {
  return <span className={cn(BOX, "inline-flex items-center border-line bg-sunken text-muted")}>{children}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="w-9 text-xs text-muted">{label}</span>
      {children}
    </span>
  );
}

/**
 * Per-customer temperature unit and the two limits that color every sensor.
 * Boxes are in the chosen unit; the server stores Celsius rise. Adjacent
 * ranges share a limit, so the two boxes that meet at a boundary edit the
 * same value and can never leave a gap or an overlap.
 */
export function DisplaySettings({
  unit: savedUnit,
  thresholds: saved,
  onSave,
}: {
  unit: TempUnit;
  thresholds: Thresholds;
  onSave: (unit: TempUnit, watchC: number, criticalC: number) => Promise<void>;
}) {
  const [unit, setUnit] = useState(savedUnit);
  const [watch, setWatch] = useState(fmt(convertRise(saved.watchC, savedUnit)));
  const [critical, setCritical] = useState(fmt(convertRise(saved.criticalC, savedUnit)));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string>();

  function changeUnit(next: TempUnit) {
    if (next === unit) return;
    // Keep what's typed meaning the same temperature rise in the new unit.
    const convert = (draft: string) => {
      const n = Number(draft);
      return draft.trim() === "" || !Number.isFinite(n) ? draft : fmt(convertRise(riseToC(n, unit), next));
    };
    setWatch(convert(watch));
    setCritical(convert(critical));
    setUnit(next);
    setStatus("idle");
  }

  const w = Number(watch);
  const c = Number(critical);
  const numeric = watch.trim() !== "" && critical.trim() !== "" && Number.isFinite(w) && Number.isFinite(c);
  const watchC = numeric ? riseToC(w, unit) : NaN;
  const criticalC = numeric ? riseToC(c, unit) : NaN;

  let problem: string | undefined;
  if (!numeric) problem = "Enter a number for both limits.";
  else if (watchC <= 0) problem = "The Watch limit must be above zero.";
  else if (criticalC <= watchC) problem = "The Critical limit must be higher than the Watch limit.";
  else if (criticalC > THRESHOLD_MAX_C) {
    problem = `The Critical limit can't be more than ${fmt(convertRise(THRESHOLD_MAX_C, unit))}°${unit} of rise.`;
  }

  const changed = unit !== savedUnit || watchC !== saved.watchC || criticalC !== saved.criticalC;
  const saving = status === "saving";

  async function save() {
    if (problem || saving) return;
    setStatus("saving");
    setError(undefined);
    try {
      await onSave(unit, watchC, criticalC);
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error && err.message ? err.message : "Couldn't save.");
    }
  }

  const watchBad = !numeric || watchC <= 0 || criticalC <= watchC;
  const criticalBad = !numeric || criticalC <= watchC || criticalC > THRESHOLD_MAX_C;

  return (
    <Card>
      <CardHeader className="flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <CardTitle>Temperature display and alert colors</CardTitle>
        <div role="radiogroup" aria-label="Temperature unit" className="inline-flex rounded-md border border-line p-0.5">
          {(["F", "C"] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => changeUnit(u)}
              className={cn(
                "h-8 min-w-12 rounded px-3 text-sm font-medium transition-colors",
                unit === u ? "bg-brand text-white" : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              °{u}
            </button>
          ))}
        </div>
      </CardHeader>

      <div className="px-5 pt-4 text-sm text-muted">
        These apply to every sensor on this customer&apos;s dashboard. Limits are temperature rise above ambient, the
        same number shown on the dashboard.
      </div>

      <ul className="mt-3 divide-y divide-line border-y border-line">
        {ROWS.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
            <span className="flex w-40 items-center gap-2.5">
              <span aria-hidden className={cn("size-3 shrink-0 rounded-full", row.swatch)} />
              <span className="text-sm">
                <span className="font-medium text-ink">{row.label}</span>
                <span className="text-muted"> · {row.color}</span>
              </span>
            </span>

            <Field label="From">
              {row.key === "normal" ? (
                <FixedLimit>0</FixedLimit>
              ) : row.key === "watch" ? (
                <LimitInput value={watch} onChange={setWatch} label={`Watch from, °${unit} of rise`} invalid={watchBad} />
              ) : (
                <LimitInput
                  value={critical}
                  onChange={setCritical}
                  label={`Critical from, °${unit} of rise`}
                  invalid={criticalBad}
                />
              )}
            </Field>

            <Field label="To">
              {row.key === "normal" ? (
                <LimitInput value={watch} onChange={setWatch} label={`Normal up to, °${unit} of rise`} invalid={watchBad} />
              ) : row.key === "watch" ? (
                <LimitInput
                  value={critical}
                  onChange={setCritical}
                  label={`Watch up to, °${unit} of rise`}
                  invalid={criticalBad}
                />
              ) : (
                <FixedLimit>and above</FixedLimit>
              )}
            </Field>

            <span className="text-sm text-muted">°{unit}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <Button onClick={() => void save()} disabled={!changed || Boolean(problem) || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <span aria-live="polite" className="text-sm">
          {problem && changed && <span className="text-critical">{problem}</span>}
          {!problem && status === "error" && <span className="text-critical">{error}</span>}
          {!problem && status === "saved" && !changed && <span className="text-ok">Saved. The dashboard updates on its next load.</span>}
        </span>
      </div>
    </Card>
  );
}
