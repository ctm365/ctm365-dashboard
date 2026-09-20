import "server-only";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DEFAULT_TEMP_UNIT, DEFAULT_THRESHOLDS } from "../fleet";
import type { AssetConfig, CustomerConfig, SensorConfig } from "./types";
import { isTempUnit, normalizeThresholds } from "./validation";

/**
 * Per-customer dashboard labels in DynamoDB. One item per customer:
 * { customer_id, siteName, assets, sensors, updatedAt }.
 *
 * No explicit credentials: the default AWS provider chain supplies them
 * (locally, the AWS CLI profile). Never put access keys in .env.local.
 */

const TABLE_NAME = "ctm365_customer_config";
const REGION = "us-west-2";

let client: DynamoDBDocumentClient | undefined;

function getClient() {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return client;
}

/** Thrown when a conditional update keeps losing to concurrent writes. */
export class ConcurrentUpdateError extends Error {
  name = "ConcurrentUpdateError";
}

function isConditionalCheckFailed(err: unknown) {
  return err instanceof Error && err.name === "ConditionalCheckFailedException";
}

// Items can also be edited by hand in the console, so read them defensively.
function fromItem(item: Record<string, unknown>): CustomerConfig {
  const assets: AssetConfig[] = Array.isArray(item.assets)
    ? item.assets
        .filter((a): a is AssetConfig => typeof a?.id === "string" && typeof a?.name === "string")
        .map(({ id, name }) => ({ id, name }))
    : [];
  const sensors: SensorConfig[] = Array.isArray(item.sensors)
    ? item.sensors
        .filter(
          (s): s is SensorConfig =>
            typeof s?.id === "string" &&
            typeof s?.name === "string" &&
            typeof s?.assetId === "string" &&
            typeof s?.channel === "number",
        )
        .map(({ id, name, assetId, channel }) => ({ id, name, assetId, channel }))
    : [];
  return {
    customerId: String(item.customer_id),
    siteName: typeof item.siteName === "string" ? item.siteName : "",
    assets,
    sensors,
    // Items saved before these settings existed have neither field.
    tempUnit: isTempUnit(item.tempUnit) ? item.tempUnit : DEFAULT_TEMP_UNIT,
    thresholds: normalizeThresholds(item.thresholds, DEFAULT_THRESHOLDS),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
  };
}

function toItem(config: CustomerConfig) {
  return {
    customer_id: config.customerId,
    siteName: config.siteName,
    assets: config.assets,
    sensors: config.sensors,
    tempUnit: config.tempUnit,
    thresholds: config.thresholds,
    updatedAt: config.updatedAt,
  };
}

export async function getCustomerConfig(customerId: string): Promise<CustomerConfig | null> {
  const out = await getClient().send(new GetCommand({ TableName: TABLE_NAME, Key: { customer_id: customerId } }));
  return out.Item ? fromItem(out.Item) : null;
}

export async function putCustomerConfig(config: CustomerConfig): Promise<void> {
  await getClient().send(
    new PutCommand({ TableName: TABLE_NAME, Item: toItem({ ...config, updatedAt: new Date().toISOString() }) }),
  );
}

/**
 * Scan is fine for a handful of customers. If the customer count grows a
 * lot, replace this with a paginated query on a proper index.
 */
export async function listCustomerConfigs(): Promise<CustomerConfig[]> {
  const configs: CustomerConfig[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await getClient().send(new ScanCommand({ TableName: TABLE_NAME, ExclusiveStartKey: startKey }));
    configs.push(...(out.Items ?? []).map(fromItem));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return configs;
}

/** Removes a customer's config entirely. Use sparingly. */
export async function deleteCustomerConfig(customerId: string): Promise<void> {
  await getClient().send(new DeleteCommand({ TableName: TABLE_NAME, Key: { customer_id: customerId } }));
}

/** Creates an empty config. Returns false (and writes nothing) if one already exists. */
export async function createCustomerConfig(customerId: string): Promise<boolean> {
  try {
    await getClient().send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: toItem({
          customerId,
          siteName: "Unnamed site",
          assets: [],
          sensors: [],
          tempUnit: DEFAULT_TEMP_UNIT,
          thresholds: DEFAULT_THRESHOLDS,
          updatedAt: new Date().toISOString(),
        }),
        ConditionExpression: "attribute_not_exists(customer_id)",
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }
}

/**
 * Read-modify-write guarded by updatedAt, so two edits saved at the same
 * moment can't silently overwrite each other. Returns null if the customer
 * doesn't exist.
 */
export async function updateCustomerConfig(
  customerId: string,
  change: (current: CustomerConfig) => CustomerConfig,
): Promise<CustomerConfig | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getCustomerConfig(customerId);
    if (!current) return null;

    const next = { ...change(current), customerId, updatedAt: new Date().toISOString() };
    try {
      await getClient().send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: toItem(next),
          ConditionExpression: current.updatedAt ? "updatedAt = :prev" : "attribute_not_exists(updatedAt)",
          ExpressionAttributeValues: current.updatedAt ? { ":prev": current.updatedAt } : undefined,
        }),
      );
      return next;
    } catch (err) {
      if (!isConditionalCheckFailed(err)) throw err;
      // Someone else wrote first (or the item was deleted): re-read and try again.
    }
  }
  throw new ConcurrentUpdateError("Customer config changed during update");
}
