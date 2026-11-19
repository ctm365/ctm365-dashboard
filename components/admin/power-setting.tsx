"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { POWER_METER_ID_RULE } from "@/lib/config/validation";

type Settings = { meterId: string; showVoltage: boolean; showCurrent: boolean };

function Switch({ id, label, hint, on, disabled, onToggle }: { id: string; label: string; hint: string; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      <span className="w-8 text-right text-xs text-muted" aria-hidden>
        {on ? "On" : "Off"}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60",
          on ? "bg-brand" : "bg-line",
        )}
      >
        <span aria-hidden className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

/**
 * The electrical panel's power meter and whether the customer's Electrical
 * page shows its voltage and current. Switches save immediately; the meter
 * ID saves with its own button.
 */
export function PowerSetting({
  meterId,
  showVoltage,
  showCurrent,
  sampleData,
  onSave,
}: {
  meterId: string | null;
  showVoltage: boolean;
  showCurrent: boolean;
  sampleData: boolean;
  onSave: (next: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(meterId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const current = { meterId: meterId ?? "", showVoltage, showCurrent };

  async function save(next: Settings) {
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      await onSave(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  function submitMeter(e: FormEvent) {
    e.preventDefault();
    if (draft.trim() === current.meterId) return;
    void save({ ...current, meterId: draft.trim() });
  }

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1 border-b border-line pb-3">
        <CardTitle>Panel voltage and current</CardTitle>
        <p className="text-sm text-muted">
          Per-phase readings from a WattNode on the electrical panel, shown on the customer&apos;s Electrical page. Its
          gateway publishes to <code className="tabular text-ink">ctm365/&lt;site&gt;/power/{draft.trim() || "<meter-id>"}</code>.
        </p>
      </CardHeader>
      <div className="flex flex-col gap-4 px-5 py-4">
        <Switch
          id="show-voltage"
          label="Show voltage"
          hint="Voltage per phase, with imbalance and a 90-minute trend."
          on={showVoltage}
          disabled={saving}
          onToggle={() => void save({ ...current, showVoltage: !showVoltage })}
        />
        <Switch
          id="show-current"
          label="Show current"
          hint="Amps per phase, with imbalance and a 90-minute trend."
          on={showCurrent}
          disabled={saving}
          onToggle={() => void save({ ...current, showCurrent: !showCurrent })}
        />
        <form onSubmit={submitMeter} className="flex flex-col gap-2 border-t border-line pt-4">
          <label htmlFor="power-meter-id" className="text-sm font-medium text-ink">
            Power meter ID
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="power-meter-id"
              aria-describedby="power-meter-rule"
              placeholder="e.g. panel-01"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaved(false);
              }}
              maxLength={64}
              pattern="[A-Za-z0-9._\-]{1,64}"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-9 min-w-0 flex-1 basis-56 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus-visible:border-brand"
            />
            <Button type="submit" variant="secondary" disabled={saving || draft.trim() === current.meterId}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          <p id="power-meter-rule" className="text-xs text-muted">
            {POWER_METER_ID_RULE} Leave blank if there&apos;s no panel meter.
          </p>
        </form>
        <p aria-live="polite" className="text-sm empty:hidden">
          {error && <span className="text-critical">{error}</span>}
          {!error && saved && <span className="text-ok">Saved. The customer sees the change on their next page load.</span>}
          {!error && !saved && (showVoltage || showCurrent) && !meterId && !sampleData && (
            <span className="text-watch">No power meter yet, so the customer sees &ldquo;meter not connected&rdquo;.</span>
          )}
          {!error && !saved && (showVoltage || showCurrent) && sampleData && (
            <span className="text-muted">Sample data is on, so the customer sees the demo panel.</span>
          )}
        </p>
      </div>
    </Card>
  );
}
