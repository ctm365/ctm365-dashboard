"use client";

import { useState, useTransition, type FormEvent } from "react";
import { addHvacUnit, removeHvacUnit, renameHvacUnit, type ConfigResult } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { CustomerConfig } from "@/lib/config/types";
import { HVAC_UNIT_ID_RULE, NAME_MAX_LENGTH } from "@/lib/config/validation";
import { EditableText } from "./editable-text";

const INPUT =
  "h-9 min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus-visible:border-brand";

/** Add, rename and remove a customer's HVAC units. */
export function HvacUnitsEditor({
  config,
  onSaved,
}: {
  config: CustomerConfig;
  onSaved: (next: CustomerConfig) => void;
}) {
  const { customerId, hvacUnits } = config;
  const [unitId, setUnitId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ConfigResult>, after?: () => void) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.config);
      after?.();
    });
  }

  function onAdd(e: FormEvent) {
    e.preventDefault();
    run(
      () => addHvacUnit(customerId, unitId, name),
      () => {
        setUnitId("");
        setName("");
      },
    );
  }

  function onRemove(id: string, unitName: string) {
    if (!window.confirm(`Remove "${unitName}" from this customer's dashboard? Its readings are kept.`)) return;
    run(() => removeHvacUnit(customerId, id));
  }

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1 border-b border-line pb-3">
        <CardTitle>HVAC units</CardTitle>
        <p className="text-sm text-muted">
          Each unit&apos;s ID must match the end of its gateway&apos;s MQTT topic, so its readings show up here.
        </p>
      </CardHeader>

      {hvacUnits.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">No HVAC units yet. The customer&apos;s HVAC page says none are set up.</p>
      ) : (
        <ul className="divide-y divide-line">
          {hvacUnits.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
              <span className="min-w-0 flex-1 basis-48 text-sm">
                <EditableText
                  value={u.name}
                  label={`Name for unit ${u.id}`}
                  maxLength={NAME_MAX_LENGTH}
                  className="font-medium"
                  onSave={async (next) => {
                    const result = await renameHvacUnit(customerId, u.id, next);
                    if (!result.ok) throw new Error(result.error);
                    onSaved(result.config);
                  }}
                />
              </span>
              <span className="tabular text-xs text-muted">{u.id}</span>
              <Button
                variant="ghost"
                className="h-8 px-3 hover:text-critical"
                disabled={pending}
                aria-label={`Remove ${u.name}`}
                onClick={() => onRemove(u.id, u.name)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onAdd} className="flex flex-col gap-2 border-t border-line px-5 py-4">
        <span className="text-sm font-medium text-ink">Add a unit</span>
        <div className="flex flex-wrap gap-2">
          <input
            id="hvac-unit-id"
            aria-label="Unit ID"
            aria-describedby="hvac-unit-id-rule"
            placeholder="Unit ID, e.g. bard-02"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            required
            maxLength={64}
            pattern="[A-Za-z0-9._\-]{1,64}"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={`${INPUT} basis-40 flex-1`}
          />
          <input
            id="hvac-unit-name"
            aria-label="Unit name"
            placeholder="Name, e.g. Bard W42HC Heat Pump"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={NAME_MAX_LENGTH}
            className={`${INPUT} basis-56 flex-[2]`}
          />
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Saving…" : "Add unit"}
          </Button>
        </div>
        <p id="hvac-unit-id-rule" className="text-xs text-muted">
          {HVAC_UNIT_ID_RULE}
        </p>
        <div aria-live="assertive">
          {error && <p className="rounded-md bg-critical-soft px-3 py-2 text-sm text-critical">{error}</p>}
        </div>
      </form>
    </Card>
  );
}
