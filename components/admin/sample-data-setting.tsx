"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

/** Switches this customer's Electrical page to the fixed sample scenario, for demos. Saves when flipped. */
export function SampleDataSetting({
  on,
  onSave,
  id = "sample-data",
  description = "The Electrical page shows a fixed example (most sensors normal, one on watch, one critical) instead of live readings, labelled “Sample data”. Use it for prospects, never for a real customer.",
}: {
  on: boolean;
  onSave: (next: boolean) => Promise<void>;
  id?: string;
  description?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function toggle() {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(!on);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-2 px-5 py-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="text-sm font-medium text-ink">
            Show sample data (for demos)
          </label>
          <p className="text-sm text-muted">{description}</p>
        </div>
        <span className="w-16 text-right text-xs text-muted" aria-hidden>
          {saving ? "Saving…" : on ? "On" : "Off"}
        </span>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={on}
          disabled={saving}
          onClick={() => void toggle()}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60",
            on ? "bg-brand" : "bg-line",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-5 rounded-full bg-white shadow transition-transform",
              on ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      {error && <p className="text-sm text-critical">{error}</p>}
    </Card>
  );
}
