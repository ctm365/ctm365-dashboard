"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "@/components/ui/cn";
import { CHANNEL_MAX, CHANNEL_MIN } from "@/lib/config/validation";

/** Small 1-8 number input that saves on blur or Enter; Escape reverts. */
export function ChannelInput({
  value,
  onSave,
  label,
}: {
  value: number;
  onSave: (next: number) => Promise<void>;
  label: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string>();
  const [lastValue, setLastValue] = useState(value);

  // Follow server updates when not mid-edit.
  if (value !== lastValue) {
    setLastValue(value);
    if (status !== "saving") setDraft(String(value));
  }

  async function commit() {
    if (status === "saving") return;
    const next = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(next) || next < CHANNEL_MIN || next > CHANNEL_MAX) {
      setStatus("error");
      setError(`Use ${CHANNEL_MIN}-${CHANNEL_MAX}.`);
      return;
    }
    if (next === value) {
      setStatus("idle");
      setError(undefined);
      return;
    }
    setStatus("saving");
    setError(undefined);
    try {
      await onSave(next);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error && err.message ? err.message : "Couldn't save.");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      setDraft(String(value));
      setStatus("idle");
      setError(undefined);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <input
        type="number"
        inputMode="numeric"
        min={CHANNEL_MIN}
        max={CHANNEL_MAX}
        step={1}
        aria-label={label}
        aria-invalid={status === "error" || undefined}
        aria-busy={status === "saving" || undefined}
        value={draft}
        readOnly={status === "saving"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
        className={cn(
          "tabular h-8 w-16 rounded-md border border-line bg-surface px-2 text-sm text-ink",
          status === "saving" && "opacity-60",
          status === "error" && "border-critical",
        )}
      />
      <span aria-live="polite" className="text-xs">
        {status === "saving" && <span className="text-muted">Saving…</span>}
        {status === "saved" && <span className="text-ok">Saved</span>}
        {status === "error" && <span className="text-critical">{error}</span>}
      </span>
    </span>
  );
}
