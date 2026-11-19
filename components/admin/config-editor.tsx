"use client";

import { useState, useTransition } from "react";
import {
  addAsset,
  addSensor,
  removeAsset,
  removeSensor,
  renameAsset,
  renameSensor,
  setSensorChannel,
  updateDatacardId,
  updateDisplaySettings,
  updateHvacSampleData,
  updatePowerSettings,
  updateSampleData,
  updateServices,
  updateSiteName,
  type ConfigResult,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { CustomerConfig, SensorConfig } from "@/lib/config/types";
import { CHANNEL_MAX, CHANNEL_MIN, NAME_MAX_LENGTH } from "@/lib/config/validation";
import { ChannelInput } from "./channel-input";
import { DatacardSetting } from "./datacard-setting";
import { DeleteCustomer } from "./delete-customer";
import { DisplaySettings } from "./display-settings";
import { EditableText } from "./editable-text";
import { HvacUnitsEditor } from "./hvac-units-editor";
import { PowerSetting } from "./power-setting";
import { SampleDataSetting } from "./sample-data-setting";
import { ServicesSettings } from "./services-settings";
import { UsersCard } from "./users-card";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Shown in place of a service's setup while that service is off. */
function ServiceOffNote({ service, kept }: { service: string; kept: string }) {
  return (
    <Card className="px-5 py-4 text-sm text-muted">
      <span className="font-medium text-ink">{service} is off.</span> {kept} Turn it on under Services to show it to
      the customer again.
    </Card>
  );
}

function nextFreeChannel(sensors: SensorConfig[]) {
  const used = new Set(sensors.map((s) => s.channel));
  for (let ch = CHANNEL_MIN; ch <= CHANNEL_MAX; ch++) {
    if (!used.has(ch)) return ch;
  }
  return CHANNEL_MIN;
}

function formatUpdated(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "never" : date.toLocaleString();
}

export function ConfigEditor({ initialConfig, currentUserSub }: { initialConfig: CustomerConfig; currentUserSub: string }) {
  const [config, setConfig] = useState(initialConfig);
  /** Newly added item whose name opens in edit mode. */
  const [newItemId, setNewItemId] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const { customerId } = config;

  /** For inline edits: EditableText shows the error, so throw it. */
  async function save(run: () => Promise<ConfigResult>) {
    const result = await run();
    if (!result.ok) throw new Error(result.error);
    setConfig(result.config);
  }

  /** For add/remove buttons: show errors in the banner. */
  function runStructural(run: () => Promise<ConfigResult>) {
    setActionError(undefined);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setConfig(result.config);
      setNewItemId(result.createdId);
    });
  }

  function onAddAsset() {
    runStructural(() => addAsset(customerId, `Asset ${config.assets.length + 1}`));
  }

  function onRemoveAsset(assetId: string, name: string, sensorCount: number) {
    const detail = sensorCount > 0 ? ` and its ${sensorCount} sensor${sensorCount === 1 ? "" : "s"}` : "";
    if (!window.confirm(`Remove "${name}"${detail}?`)) return;
    runStructural(() => removeAsset(customerId, assetId));
  }

  function onAddSensor(assetId: string) {
    runStructural(() =>
      addSensor(customerId, assetId, `Sensor ${config.sensors.length + 1}`, nextFreeChannel(config.sensors)),
    );
  }

  function onRemoveSensor(sensorId: string, name: string) {
    if (!window.confirm(`Remove "${name}"?`)) return;
    runStructural(() => removeSensor(customerId, sensorId));
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-2 pt-5">
          <span className="text-xs font-medium text-muted">Site name</span>
          <h1 className="min-w-0">
            <EditableText
              value={config.siteName}
              label="Site name"
              maxLength={NAME_MAX_LENGTH}
              className="font-display text-2xl font-semibold"
              onSave={(name) => save(() => updateSiteName(customerId, name))}
            />
          </h1>
          <p className="text-xs text-muted">
            Customer ID <span className="tabular font-medium text-ink">{customerId}</span> · Updated{" "}
            {formatUpdated(config.updatedAt)}
          </p>
          <p className="text-sm text-muted">
            The customer sees these labels on their dashboard.
          </p>
        </CardContent>
      </Card>

      <ServicesSettings
        services={config.services}
        onSave={(next) => save(() => updateServices(customerId, next))}
      />

      <h2 className="-mb-2 font-display text-lg font-semibold text-ink">Electrical</h2>
      {!config.services.electrical ? (
        <ServiceOffNote
          service="Electrical"
          kept={`Its ${plural(config.assets.length, "asset")} and ${plural(config.sensors.length, "sensor")} are kept.`}
        />
      ) : (
        <>
          <SampleDataSetting
            on={config.electricalSampleData}
            onSave={(next) => save(() => updateSampleData(customerId, next))}
          />

          <DatacardSetting
            datacardId={config.electricalDatacardId}
            onSave={(next) => save(() => updateDatacardId(customerId, next))}
          />

          <PowerSetting
            meterId={config.electricalPowerMeterId}
            showVoltage={config.showVoltage}
            showCurrent={config.showCurrent}
            sampleData={config.electricalSampleData}
            onSave={(next) => save(() => updatePowerSettings(customerId, next))}
          />

          <DisplaySettings
            unit={config.tempUnit}
            thresholds={config.thresholds}
            onSave={(unit, watchC, criticalC) => save(() => updateDisplaySettings(customerId, unit, watchC, criticalC))}
          />

          <div aria-live="assertive">
            {actionError && (
              <p className="rounded-md bg-critical-soft px-3 py-2 text-sm text-critical">{actionError}</p>
            )}
          </div>

          {config.assets.length === 0 && (
            <Card className="p-6 text-center text-sm text-muted">No assets yet. Add one to start adding sensors.</Card>
          )}

          {config.assets.map((asset) => {
            const sensors = config.sensors.filter((s) => s.assetId === asset.id);
            return (
              <Card key={asset.id}>
                <CardHeader className="flex-wrap items-center border-b border-line pb-3">
                  <h2 className="min-w-0 flex-1">
                    <EditableText
                      value={asset.name}
                      label="Asset name"
                      maxLength={NAME_MAX_LENGTH}
                      autoEdit={asset.id === newItemId}
                      className="font-display text-base font-semibold"
                      onSave={(name) => save(() => renameAsset(customerId, asset.id, name))}
                    />
                  </h2>
                  <Button
                    variant="ghost"
                    className="h-8 px-3 hover:text-critical"
                    disabled={pending}
                    onClick={() => onRemoveAsset(asset.id, asset.name, sensors.length)}
                  >
                    Remove asset
                  </Button>
                </CardHeader>

                {sensors.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-muted">No sensors on this asset yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    <li aria-hidden className="hidden gap-4 px-5 py-2 text-xs font-medium text-muted sm:flex">
                      <span className="flex-1">Sensor</span>
                      <span className="w-16">Channel</span>
                      <span className="w-[4.5rem]" />
                    </li>
                    {sensors.map((sensor) => (
                      <li key={sensor.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
                        <span className="min-w-0 flex-1 basis-48 pt-1 text-sm">
                          <EditableText
                            value={sensor.name}
                            label="Sensor name"
                            maxLength={NAME_MAX_LENGTH}
                            autoEdit={sensor.id === newItemId}
                            className="font-medium"
                            onSave={(name) => save(() => renameSensor(customerId, sensor.id, name))}
                          />
                        </span>
                        <ChannelInput
                          value={sensor.channel}
                          label={`Channel for ${sensor.name}`}
                          onSave={(channel) => save(() => setSensorChannel(customerId, sensor.id, channel))}
                        />
                        <Button
                          variant="ghost"
                          className="h-8 px-3 hover:text-critical"
                          disabled={pending}
                          aria-label={`Remove ${sensor.name}`}
                          onClick={() => onRemoveSensor(sensor.id, sensor.name)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="border-t border-line px-5 py-3">
                  <Button variant="secondary" className="h-8 px-3" disabled={pending} onClick={() => onAddSensor(asset.id)}>
                    Add sensor
                  </Button>
                </div>
              </Card>
            );
          })}

          <div>
            <Button disabled={pending} onClick={onAddAsset}>
              Add asset
            </Button>
          </div>
        </>
      )}

      <h2 className="-mb-2 mt-2 font-display text-lg font-semibold text-ink">HVAC</h2>
      {!config.services.hvac ? (
        <ServiceOffNote service="HVAC" kept={`Its ${plural(config.hvacUnits.length, "unit")} ${config.hvacUnits.length === 1 ? "is" : "are"} kept.`} />
      ) : (
        <>
          <SampleDataSetting
            id="hvac-sample-data"
            on={config.hvacSampleData}
            description="The HVAC page shows a sample Bard heat pump (all readings, refrigerant probes, health and runs) instead of live readings, labelled “Sample data”. For demos, or while the unit's equipment is offline. Live data, analytics and alerts carry on underneath."
            onSave={(next) => save(() => updateHvacSampleData(customerId, next))}
          />
          <HvacUnitsEditor config={config} onSaved={setConfig} />
        </>
      )}

      <h2 className="-mb-2 mt-2 font-display text-lg font-semibold text-ink">Users</h2>
      <UsersCard customerId={customerId} currentUserSub={currentUserSub} />

      <h2 className="-mb-2 mt-2 font-display text-lg font-semibold text-ink">Danger zone</h2>
      <DeleteCustomer customerId={customerId} />
    </div>
  );
}
