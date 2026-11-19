import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { buildEmail, channelsFrom, customersForDatacard, evaluate } from "./logic.mjs";

/**
 * ctm365-alerts: invoked by the electrical IoT rules with every datacard
 * message ({ sensor_id, timestamp, properties: { Sensor1..8 } }). Emails
 * ALERT_TO when a sensor confirms Critical. State per customer+sensor lives in
 * ctm365_alert_state so each sensor alerts once until it re-arms.
 *
 * Env: ALERT_TO (comma-separated), ALERT_FROM, REPLY_TO (optional),
 * DASHBOARD_URL, TIME_ZONE, CONFIG_TABLE, STATE_TABLE.
 */

const env = {
  to: (process.env.ALERT_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  from: process.env.ALERT_FROM ?? "CTM365 Alerts <alerts@ctm365.com>",
  replyTo: (process.env.REPLY_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  dashboardUrl: process.env.DASHBOARD_URL ?? "https://dashboard.ctm365.com",
  timeZone: process.env.TIME_ZONE ?? "America/Los_Angeles",
  configTable: process.env.CONFIG_TABLE ?? "ctm365_customer_config",
  stateTable: process.env.STATE_TABLE ?? "ctm365_alert_state",
};

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({});

/** Customer configs, re-read at most once a minute (messages arrive every ~15 s per datacard). */
let cache = { at: 0, items: [] };
async function customerConfigs() {
  if (Date.now() - cache.at < 60_000) return cache.items;
  const items = [];
  let ExclusiveStartKey;
  do {
    const out = await db.send(new ScanCommand({ TableName: env.configTable, ExclusiveStartKey }));
    for (const i of out.Items ?? []) items.push({ ...i, customerId: i.customer_id });
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  cache = { at: Date.now(), items };
  return items;
}

export async function handler(event) {
  const datacardId = typeof event?.sensor_id === "string" ? event.sensor_id : null;
  if (!datacardId) return { skipped: "no sensor_id" };
  const ts = Number(event.timestamp) || Date.now();
  const channels = channelsFrom(event.properties);

  const customers = customersForDatacard(await customerConfigs(), datacardId);
  let sent = 0;

  for (const customer of customers) {
    const keys = (customer.sensors ?? []).map((s) => `${customer.customerId}#${s.id}`);
    const prev = {};
    await Promise.all(
      keys.map(async (key) => {
        const out = await db.send(new GetCommand({ TableName: env.stateTable, Key: { alert_key: key } }));
        if (out.Item) prev[key] = { status: out.Item.status, streak: Number(out.Item.streak) || 0 };
      }),
    );

    const { states, alerts } = evaluate(customer, channels, ts, prev);

    for (const alert of alerts) {
      if (env.to.length === 0) {
        console.warn(`[alerts] ALERT_TO is empty; not sending alert for ${customer.customerId}/${alert.sensor.id}`);
        continue;
      }
      const email = buildEmail(alert, env);
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: env.from,
          Destination: { ToAddresses: env.to },
          ReplyToAddresses: env.replyTo.length ? env.replyTo : undefined,
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: { Text: { Data: email.text, Charset: "UTF-8" }, Html: { Data: email.html, Charset: "UTF-8" } },
            },
          },
        }),
      );
      sent++;
      console.info(`[alerts] sent critical alert ${customer.customerId}/${alert.sensor.id} value=${alert.value}`);
    }

    // Saved after sending, so a failed send is retried on the next reading rather than lost.
    await Promise.all(
      states.map((s) =>
        db.send(
          new PutCommand({
            TableName: env.stateTable,
            Item: {
              alert_key: s.key,
              customer_id: customer.customerId,
              status: s.status,
              streak: s.streak,
              last_value_c: s.value,
              last_ts: s.ts,
              updated_at: new Date().toISOString(),
            },
          }),
        ),
      ),
    );
  }
  return { datacardId, customers: customers.length, sent };
}
