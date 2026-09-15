"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminAction } from "@/lib/auth/session";
import { ConcurrentUpdateError, createCustomerConfig, updateCustomerConfig } from "@/lib/config/store";
import type { CustomerConfig } from "@/lib/config/types";
import {
  ConfigInputError,
  MAX_ASSETS,
  MAX_SENSORS,
  parseChannel,
  parseCustomerId,
  parseName,
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
    revalidatePath(`/admin/${customerId}`);
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
  const input = typeof raw === "string" ? raw.trim().slice(0, 64) : "";
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
  redirect(`/admin/${customerId}`);
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
