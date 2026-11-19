"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { SERVICES } from "@/lib/services";
import type { ServiceId, Services } from "@/lib/types";

const DESCRIPTION: Record<ServiceId, string> = {
  electrical: "Temperature-rise sensors on electrical equipment, with live readings and alert colors.",
  hvac: "HVAC units: air temperatures, static pressure, and power, updated every minute.",
};

/**
 * Turns each service on or off for this customer. A service that is off is
 * hidden from the customer's dashboard; its setup below is kept.
 * Each switch saves as soon as it's flipped.
 */
export function ServicesSettings({
  services,
  onSave,
}: {
  services: Services;
  onSave: (next: Services) => Promise<void>;
}) {
  const [saving, setSaving] = useState<ServiceId | null>(null);
  const [error, setError] = useState<string>();

  async function toggle(id: ServiceId) {
    if (saving) return;
    setSaving(id);
    setError(undefined);
    try {
      await onSave({ ...services, [id]: !services[id] });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save.");
    } finally {
      setSaving(null);
    }
  }

  const noneOn = !services.electrical && !services.hvac;

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1 border-b border-line pb-3">
        <CardTitle>Services</CardTitle>
        <p className="text-sm text-muted">
          The customer only sees the services that are on. Turning one off hides it but keeps its setup.
        </p>
      </CardHeader>

      <ul className="divide-y divide-line">
        {SERVICES.map((s) => {
          const on = services[s.id];
          const id = `service-${s.id}`;
          return (
            <li key={s.id} className="flex items-center gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <label htmlFor={id} className="text-sm font-medium text-ink">
                  {s.label}
                </label>
                <p className="text-sm text-muted">{DESCRIPTION[s.id]}</p>
              </div>
              <span className="w-16 text-right text-xs text-muted" aria-hidden>
                {saving === s.id ? "Saving…" : on ? "On" : "Off"}
              </span>
              <button
                id={id}
                type="button"
                role="switch"
                aria-checked={on}
                disabled={saving !== null}
                onClick={() => void toggle(s.id)}
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
            </li>
          );
        })}
      </ul>

      <div aria-live="polite" className="px-5 pb-4 empty:hidden">
        {error && <p className="pt-3 text-sm text-critical">{error}</p>}
        {!error && noneOn && (
          <p className="pt-3 text-sm text-watch">
            No services are on, so this customer&apos;s dashboard says monitoring isn&apos;t set up yet.
          </p>
        )}
      </div>
    </Card>
  );
}
