"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DATACARD_ID_RULE } from "@/lib/config/validation";

/**
 * Which Exertherm datacard feeds this customer's sensors. Sensor channels
 * 1-8 below map to that card's Sensor1-Sensor8.
 */
export function DatacardSetting({
  datacardId,
  onSave,
}: {
  datacardId: string | null;
  onSave: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(datacardId ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string>();
  const changed = draft.trim() !== (datacardId ?? "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || status === "saving") return;
    setStatus("saving");
    setError(undefined);
    try {
      await onSave(draft.trim());
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error && err.message ? err.message : "Couldn't save.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1 border-b border-line pb-3">
        <CardTitle>Datacard</CardTitle>
        <p className="text-sm text-muted">
          The Exertherm datacard whose readings feed the sensors below. Its gateway publishes to{" "}
          <code className="tabular text-ink">ctm365/&lt;site&gt;/electrical/{draft.trim() || "<datacard-id>"}</code>.
          Each sensor&apos;s channel picks one of the card&apos;s 8 inputs.
        </p>
      </CardHeader>
      <form onSubmit={submit} className="flex flex-col gap-2 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="datacard-id"
            aria-label="Datacard ID"
            aria-describedby="datacard-id-rule"
            placeholder="e.g. exertherm-07"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setStatus("idle");
            }}
            maxLength={64}
            pattern="[A-Za-z0-9._\-]{1,64}"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 basis-56 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus-visible:border-brand"
          />
          <Button type="submit" variant="secondary" disabled={!changed || status === "saving"}>
            {status === "saving" ? "Saving…" : "Save"}
          </Button>
        </div>
        <p id="datacard-id-rule" className="text-xs text-muted">
          {DATACARD_ID_RULE} Leave blank to disconnect.
        </p>
        <p aria-live="polite" className="text-sm empty:hidden">
          {status === "error" && <span className="text-critical">{error}</span>}
          {status === "saved" && !changed && (
            <span className="text-ok">
              {datacardId ? "Saved. The dashboard reads this datacard on its next load." : "Datacard disconnected."}
            </span>
          )}
          {!datacardId && status === "idle" && !changed && (
            <span className="text-watch">No datacard yet, so the customer&apos;s Electrical page says it isn&apos;t connected.</span>
          )}
        </p>
      </form>
    </Card>
  );
}
