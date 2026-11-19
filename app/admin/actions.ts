"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/auth/session";
import {
  ConcurrentUpdateError,
  createCustomerConfig,
  deleteCustomerConfig,
  getCustomerConfig,
  updateCustomerConfig,
} from "@/lib/config/store";
import type { CustomerConfig } from "@/lib/config/types";
import { restartLearning } from "@/lib/hvac-health";
import {
  CUSTOMER_ID_MAX_LENGTH,
  ConfigInputError,
  MAX_ASSETS,
  MAX_HVAC_UNITS,
  MAX_SENSORS,
  parseChannel,
  adminCustomerPath,
  parseCustomerId,
  parseDatacardId,
  parseHvacUnitId,
  parseName,
  parseServices,
  parseTempUnit,
  parseThresholds,
} from "@/lib/config/validation";

/**
 * Admin-only Server Actions. Each one calls requireAdminAction() first; none
 * relies on the page (or another action) having checked. Unlike customer
 * data access, the target customerId comes from the admin's request here,
 * and is validated before use.
 *
 * Errors come back as values: Next.js hides thrown error messages in production.
 */

export type ConfigResult =
  | { ok: true; config: CustomerConfig; createdId?: string }
  | { ok: false; error: string };

function failure(operation: string, err: unknown): ConfigResult {
  if (err instanceof ConfigInputError) return { ok: false, error: err.message };
  if (err instanceof ConcurrentUpdateError) {
    return { ok: false, error: "This customer was changed at the same moment. Reload the page and try again." };
  }
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(`[admin] ${operation} failed: ${name}: ${err instanceof Error ? err.message : String(err)}`);
  if (name === "AccessDeniedException") {
    return { ok: false, error: "The server isn't allowed to write customer config. Check its AWS permissions." };
  }
  return { ok: false, error: "Couldn't save. Please try again." };
}

/** Validates the customer, applies the change with a conditional write, and revalidates admin pages. */
async function applyChange(
  operation: string,
  rawCustomerId: unknown,
  change: (config: CustomerConfig) => CustomerConfig,
  createdId?: string,
): Promise<ConfigResult> {
  try {
    const customerId = parseCustomerId(rawCustomerId);
    const config = await updateCustomerConfig(customerId, change);
    if (!config) return { ok: false, error: "This customer no longer exists." };
    revalidatePath("/admin");
    revalidatePath(adminCustomerPath(customerId));
    return { ok: true, config, createdId };
  } catch (err) {
    return failure(operation, err);
  }
}

function findAsset(config: CustomerConfig, assetId: unknown) {
  const asset = config.assets.find((a) => a.id === assetId);
  if (!asset) throw new ConfigInputError("That asset no longer exists. Reload the page.");
  return asset;
}

function findSensor(config: CustomerConfig, sensorId: unknown) {
  const sensor = config.sensors.find((s) => s.id === sensorId);
  if (!sensor) throw new ConfigInputError("That sensor no longer exists. Reload the page.");
  return sensor;
}

export interface CreateCustomerState {
  error?: string;
  /** Echoed back so the field keeps its value after an error. */
  customerId?: string;
}

export async function createCustomer(_prev: CreateCustomerState, formData: FormData): Promise<CreateCustomerState> {
  await requireAdminAction();

  const raw = formData.get("customerId");
  const input = typeof raw === "string" ? raw.trim().slice(0, CUSTOMER_ID_MAX_LENGTH) : "";
  let customerId: string;
  try {
    customerId = parseCustomerId(input);
    if (!(await createCustomerConfig(customerId))) {
      return { error: `A customer with ID "${customerId}" already exists.`, customerId: input };
    }
  } catch (err) {
    const result = failure("createCustomer", err);
    return { error: result.ok ? undefined : result.error, customerId: input };
  }

  revalidatePath("/admin");
  redirect(adminCustomerPath(customerId));
}

export async function updateSiteName(customerId: string, name: string): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const siteName = parseName(name, "Site name");
    return applyChange("updateSiteName", customerId, (c) => ({ ...c, siteName }));
  } catch (err) {
    return failure("updateSiteName", err);
  }
}

/**
 * Temperature unit plus the watch/critical limits (Celsius rise) that color
 * every sensor on this customer's dashboard. Saved together so they can't end up half-applied.
 */
export async function updateDisplaySettings(
  customerId: string,
  unit: string,
  watchC: number,
  criticalC: number,
): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const tempUnit = parseTempUnit(unit);
    const thresholds = parseThresholds(watchC, criticalC);
    return applyChange("updateDisplaySettings", customerId, (c) => ({ ...c, tempUnit, thresholds }));
  } catch (err) {
    return failure("updateDisplaySettings", err);
  }
}

/**
 * Which services the customer sees. Turning one off only hides it: its
 * assets, sensors and HVAC units stay, so turning it back on restores them.
 */
export async function updateServices(
  customerId: string,
  services: { electrical: boolean; hvac: boolean },
): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const next = parseServices(services);
    return applyChange("updateServices", customerId, (c) => ({ ...c, services: next }));
  } catch (err) {
    return failure("updateServices", err);
  }
}

/** Shows the fixed sample scenario on this customer's Electrical page instead of live readings. */
export async function updateSampleData(customerId: string, on: boolean): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    if (typeof on !== "boolean") throw new ConfigInputError("Choose on or off.");
    return applyChange("updateSampleData", customerId, (c) => ({ ...c, electricalSampleData: on }));
  } catch (err) {
    return failure("updateSampleData", err);
  }
}

/** The Exertherm datacard whose readings feed this customer's sensors. Blank disconnects it. */
export async function updateDatacardId(customerId: string, datacardId: string): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const id = parseDatacardId(datacardId);
    return applyChange("updateDatacardId", customerId, (c) => ({ ...c, electricalDatacardId: id }));
  } catch (err) {
    return failure("updateDatacardId", err);
  }
}

export async function addAsset(customerId: string, name: string): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const assetName = parseName(name, "Asset name");
    const id = randomUUID();
    return applyChange(
      "addAsset",
      customerId,
      (c) => {
        if (c.assets.length >= MAX_ASSETS) throw new ConfigInputError(`A site can have at most ${MAX_ASSETS} assets.`);
        return { ...c, assets: [...c.assets, { id, name: assetName }] };
      },
      id,
    );
  } catch (err) {
    return failure("addAsset", err);
  }
}

export async function renameAsset(customerId: string, assetId: string, name: string): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const assetName = parseName(name, "Asset name");
    return applyChange("renameAsset", customerId, (c) => {
      findAsset(c, assetId);
      return { ...c, assets: c.assets.map((a) => (a.id === assetId ? { ...a, name: assetName } : a)) };
    });
  } catch (err) {
    return failure("renameAsset", err);
  }
}

/** Also removes the asset's sensors. */
export async function removeAsset(customerId: string, assetId: string): Promise<ConfigResult> {
  await requireAdminAction();
  return applyChange("removeAsset", customerId, (c) => {
    findAsset(c, assetId);
    return {
      ...c,
      assets: c.assets.filter((a) => a.id !== assetId),
      sensors: c.sensors.filter((s) => s.assetId !== assetId),
    };
  });
}

export async function addSensor(
  customerId: string,
  assetId: string,
  name: string,
  channel: number,
): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const sensorName = parseName(name, "Sensor name");
    const sensorChannel = parseChannel(channel);
    const id = randomUUID();
    return applyChange(
      "addSensor",
      customerId,
      (c) => {
        findAsset(c, assetId);
        if (c.sensors.length >= MAX_SENSORS) throw new ConfigInputError(`A site can have at most ${MAX_SENSORS} sensors.`);
        return { ...c, sensors: [...c.sensors, { id, name: sensorName, assetId, channel: sensorChannel }] };
      },
      id,
    );
  } catch (err) {
    return failure("addSensor", err);
  }
}

export async function renameSensor(customerId: string, sensorId: string, name: string): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const sensorName = parseName(name, "Sensor name");
    return applyChange("renameSensor", customerId, (c) => {
      findSensor(c, sensorId);
      return { ...c, sensors: c.sensors.map((s) => (s.id === sensorId ? { ...s, name: sensorName } : s)) };
    });
  } catch (err) {
    return failure("renameSensor", err);
  }
}

export async function setSensorChannel(customerId: string, sensorId: string, channel: number): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const sensorChannel = parseChannel(channel);
    return applyChange("setSensorChannel", customerId, (c) => {
      findSensor(c, sensorId);
      return { ...c, sensors: c.sensors.map((s) => (s.id === sensorId ? { ...s, channel: sensorChannel } : s)) };
    });
  } catch (err) {
    return failure("setSensorChannel", err);
  }
}

export async function removeSensor(customerId: string, sensorId: string): Promise<ConfigResult> {
  await requireAdminAction();
  return applyChange("removeSensor", customerId, (c) => {
    findSensor(c, sensorId);
    return { ...c, sensors: c.sensors.filter((s) => s.id !== sensorId) };
  });
}

function findHvacUnit(config: CustomerConfig, unitId: unknown) {
  const unit = config.hvacUnits.find((u) => u.id === unitId);
  if (!unit) throw new ConfigInputError("That HVAC unit no longer exists. Reload the page.");
  return unit;
}

/** The unit ID must match the end of the gateway's MQTT topic, so readings land on it. */
export async function addHvacUnit(customerId: string, unitId: string, name: string): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const id = parseHvacUnitId(unitId);
    const unitName = parseName(name, "Unit name");
    return applyChange(
      "addHvacUnit",
      customerId,
      (c) => {
        if (c.hvacUnits.length >= MAX_HVAC_UNITS) {
          throw new ConfigInputError(`A site can have at most ${MAX_HVAC_UNITS} HVAC units.`);
        }
        if (c.hvacUnits.some((u) => u.id === id)) {
          throw new ConfigInputError(`This customer already has a unit with ID "${id}".`);
        }
        return { ...c, hvacUnits: [...c.hvacUnits, { id, name: unitName }] };
      },
      id,
    );
  } catch (err) {
    return failure("addHvacUnit", err);
  }
}

export async function renameHvacUnit(customerId: string, unitId: string, name: string): Promise<ConfigResult> {
  await requireAdminAction();
  try {
    const unitName = parseName(name, "Unit name");
    return applyChange("renameHvacUnit", customerId, (c) => {
      findHvacUnit(c, unitId);
      return { ...c, hvacUnits: c.hvacUnits.map((u) => (u.id === unitId ? { ...u, name: unitName } : u)) };
    });
  } catch (err) {
    return failure("renameHvacUnit", err);
  }
}

/** Removes the unit from the dashboard. Its readings stay in ctm365_hvac_telemetry. */
export async function removeHvacUnit(customerId: string, unitId: string): Promise<ConfigResult> {
  await requireAdminAction();
  return applyChange("removeHvacUnit", customerId, (c) => {
    findHvacUnit(c, unitId);
    return { ...c, hvacUnits: c.hvacUnits.filter((u) => u.id !== unitId) };
  });
}

export interface DeleteCustomerState {
  error?: string;
}

/**
 * Deletes the customer's dashboard setup (site name, services, assets,
 * sensors, HVAC units). Readings in the telemetry tables and the customer's
 * sign-in accounts are not touched. The admin must type the exact ID to confirm.
 */
export async function deleteCustomer(
  customerId: string,
  _prev: DeleteCustomerState,
  formData: FormData,
): Promise<DeleteCustomerState> {
  await requireAdminAction();
  try {
    const id = parseCustomerId(customerId);
    const typed = formData.get("confirm");
    if (typed !== id) {
      return { error: "The ID you typed doesn't match. Type it exactly, including capital letters and spaces." };
    }
    if (!(await getCustomerConfig(id))) return { error: "This customer no longer exists." };
    await deleteCustomerConfig(id);
    console.info(`[admin] deleted customer config ${JSON.stringify(id)}`);
  } catch (err) {
    const result = failure("deleteCustomer", err);
    return { error: result.ok ? undefined : result.error };
  }
  revalidatePath("/admin");
  redirect("/admin?deleted=1");
}

/**
 * Restarts what the health analytics treat as this unit's normal: it is
 * re-learned from today's data on. For a new install, after major repairs,
 * or after adding line probes.
 */
export async function restartUnitLearning(
  customerId: string,
  unitId: string,
): Promise<{ ok: true; resetAt: string } | { ok: false; error: string }> {
  await requireAdminAction();
  try {
    const id = parseCustomerId(customerId);
    const config = await getCustomerConfig(id);
    if (!config) return { ok: false, error: "This customer no longer exists." };
    findHvacUnit(config, unitId);
    const resetAt = await restartLearning(id, unitId);
    console.info(`[admin] restarted learning for ${JSON.stringify(id)}/${unitId}`);
    return { ok: true, resetAt };
  } catch (err) {
    const result = failure("restartUnitLearning", err);
    return { ok: false, error: result.ok ? "Couldn't restart learning." : result.error };
  }
}
