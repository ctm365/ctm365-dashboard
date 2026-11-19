/**
 * Pure alert rules for electrical sensors (no AWS calls), so they can be
 * unit-tested. index.mjs does the reading, storing and sending.
 *
 * Rule: a sensor alerts when it is at or above the customer's Critical limit
 * for CONFIRM_READINGS readings in a row (a single glitchy reading never
 * alerts). It alerts once, then re-arms only after dropping clearly below
 * the limit, so a sensor hovering at the line doesn't send a stream of email.
 */

/** Exertherm datacard raw value to degrees Celsius of rise. Same as lib/datacard.ts. */
export const RAW_TO_C = 0.1;
export const CONFIRM_READINGS = 2;

const DEFAULT_THRESHOLDS = { watchC: 10, criticalC: 25 };

/** Channel number (1-8) to rise in Celsius, from a datacard message's properties. */
export function channelsFrom(properties) {
  const out = {};
  for (let ch = 1; ch <= 8; ch++) {
    const raw = properties?.[`Sensor${ch}`];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n)) out[ch] = Math.round(n * RAW_TO_C * 100) / 100;
  }
  return out;
}

/** How far below Critical a sensor must drop before it can alert again. */
export function rearmMargin(t) {
  return Math.max(0.5, (t.criticalC - t.watchC) * 0.1);
}

function thresholdsOf(customer) {
  const t = customer.thresholds;
  return t && Number.isFinite(t.watchC) && Number.isFinite(t.criticalC) && t.criticalC > t.watchC ? t : DEFAULT_THRESHOLDS;
}

/** Same rule as the dashboard: items saved before services existed count as electrical if they have setup. */
function hasElectrical(customer) {
  const s = customer.services;
  if (s && typeof s.electrical === "boolean") return s.electrical;
  return (customer.assets?.length ?? 0) > 0 || (customer.sensors?.length ?? 0) > 0;
}

/** Customers whose live electrical readings come from this datacard. Demo (sample data) customers never alert. */
export function customersForDatacard(customers, datacardId) {
  return customers.filter(
    (c) => c.electricalDatacardId === datacardId && hasElectrical(c) && c.electricalSampleData !== true,
  );
}

export function stateKey(customerId, sensorId) {
  return `${customerId}#${sensorId}`;
}

/**
 * Applies one datacard reading to one customer's sensors.
 * prevStates: stateKey -> { status: "ok" | "alerted", streak: number }
 * Returns the new state for every sensor that had a value, and the alerts to send.
 */
export function evaluate(customer, channels, ts, prevStates) {
  const t = thresholdsOf(customer);
  const assets = new Map((customer.assets ?? []).map((a) => [a.id, a]));
  const states = [];
  const alerts = [];

  for (const sensor of customer.sensors ?? []) {
    const asset = assets.get(sensor.assetId);
    if (!asset) continue; // The dashboard hides sensors without an asset, so alerts do too.
    const value = channels[sensor.channel];
    if (value === undefined) continue;

    const key = stateKey(customer.customerId, sensor.id);
    const prev = prevStates[key] ?? { status: "ok", streak: 0 };
    let next;

    if (prev.status === "alerted") {
      next = value < t.criticalC - rearmMargin(t) ? { status: "ok", streak: 0 } : { status: "alerted", streak: prev.streak };
    } else if (value >= t.criticalC) {
      const streak = prev.streak + 1;
      if (streak >= CONFIRM_READINGS) {
        next = { status: "alerted", streak };
        alerts.push({ customer, asset, sensor, value, ts, thresholds: t });
      } else {
        next = { status: "ok", streak };
      }
    } else {
      next = { status: "ok", streak: 0 };
    }
    states.push({ key, ...next, value, ts });
  }
  return { states, alerts };
}

/** Temperature rise in the customer's unit (°F rise is x1.8, no +32). */
export function formatRise(c, unit) {
  const v = unit === "C" ? c : c * 1.8;
  return `${(Math.round(v * 10) / 10).toFixed(1)}°${unit === "C" ? "C" : "F"}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/** Subject, plain text and HTML for one critical alert. */
export function buildEmail(alert, { dashboardUrl, timeZone }) {
  const { customer, asset, sensor, value, ts, thresholds } = alert;
  const unit = customer.tempUnit === "C" ? "C" : "F";
  const site = customer.siteName || customer.customerId;
  const when = new Date(ts).toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const rise = formatRise(value, unit);
  const limit = formatRise(thresholds.criticalC, unit);
  const adminUrl = `${dashboardUrl}/admin/${encodeURIComponent(customer.customerId)}`;

  const subject = `CRITICAL: ${site} - ${asset.name} / ${sensor.name} at ${rise} rise`;
  const lines = [
    `${sensor.name} on ${asset.name} at ${site} reached ${rise} of temperature rise, above the Critical limit of ${limit}.`,
    "",
    `Customer: ${customer.customerId}`,
    `Site: ${site}`,
    `Asset: ${asset.name}`,
    `Sensor: ${sensor.name} (channel ${sensor.channel})`,
    `Reading: ${rise} rise (Critical from ${limit})`,
    `Time: ${when}`,
    "",
    `Customer admin page: ${adminUrl}`,
    "",
    "You'll get one email per sensor until it drops back below the limit.",
  ];
  const rows = [
    ["Customer", customer.customerId],
    ["Site", site],
    ["Asset", asset.name],
    ["Sensor", `${sensor.name} (channel ${sensor.channel})`],
    ["Reading", `${rise} rise (Critical from ${limit})`],
    ["Time", when],
  ];
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d2731">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;border-left:6px solid #a63e2c">
<tr><td style="padding:20px 24px">
<p style="margin:0 0 4px;font-size:12px;color:#a63e2c;font-weight:bold;letter-spacing:.04em">CRITICAL TEMPERATURE RISE</p>
<h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(sensor.name)} on ${escapeHtml(asset.name)}: ${escapeHtml(rise)}</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5">${escapeHtml(lines[0])}</p>
<table role="presentation" style="font-size:14px;border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#5b6773">${escapeHtml(k)}</td><td style="padding:3px 0">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>
<p style="margin:20px 0 0"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#1f5fa8;color:#ffffff;text-decoration:none;padding:9px 16px;border-radius:6px;font-size:14px">Open customer in CTM365</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#5b6773">You'll get one email per sensor until it drops back below the limit.</p>
</td></tr></table></body></html>`;
  return { subject, text: lines.join("\n"), html };
}
