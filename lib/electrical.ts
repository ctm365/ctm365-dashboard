import "server-only";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { toSample, type DatacardSample } from "./datacard";

/**
 * Real electrical readings from DynamoDB ctm365_telemetry. Electrical
 * gateways publish to ctm365/<site>/electrical/<datacard-id> about every 15 s;
 * the ctm365_electrical_rule IoT rule stores each message as one item:
 * { sensor_id: <datacard-id>, timestamp: "<epoch ms>", properties: { Sensor1..Sensor8 } }.
 * Channel N's temperature rise in Celsius is properties.SensorN x 0.1.
 *
 * Only call this with a datacard ID from the signed-in customer's own config.
 */

const TABLE_NAME = "ctm365_telemetry";
const REGION = "us-west-2";

let client: DynamoDBDocumentClient | undefined;

function getClient() {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  return client;
}

/** Samples newer than afterMs, oldest first. Timestamps are 13-digit epoch-ms strings, so they sort as text. */
export async function getDatacardSamples(datacardId: string, afterMs: number): Promise<DatacardSample[]> {
  const samples: DatacardSample[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await getClient().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "sensor_id = :d AND #ts > :after",
        ExpressionAttributeNames: { "#ts": "timestamp" },
        ExpressionAttributeValues: { ":d": datacardId, ":after": String(Math.floor(afterMs)) },
        ScanIndexForward: true,
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of out.Items ?? []) {
      const s = toSample(item);
      if (s) samples.push(s);
    }
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return samples;
}
