import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { buildBaseline, dayMetrics, findings, health, RULES, toRow } from "./analytics.mjs";
import {
  addRefSamples,
  coolingDegreeDays,
  energyFinding,
  energyModel,
  modelFromStats,
  refrigerantFindings,
  refrigerantSamples,
} from "./refrigerant.mjs";

/**
 * ctm365-hvac-health: runs hourly. For every HVAC unit of every customer with
 * the HVAC service on, it analyses today and yesterday (site-local days),
 * keeps the unit's baseline, and writes:
 *   ctm365_hvac_analytics { unit_id, sk: "day#YYYY-MM-DD" }  metrics, cycles, findings
 *   ctm365_hvac_analytics { unit_id, sk: "baseline" }        learned normal
 *   ctm365_hvac_analytics { unit_id, sk: "latest" }          health shown on the dashboard
 *
 * Event (optional): { unitIds: ["bard-01"] } to run for specific units only.
 * Env: TELEMETRY_TABLE, CONFIG_TABLE, ANALYTICS_TABLE, TIME_ZONE.
 */

const env = {
  telemetry: process.env.TELEMETRY_TABLE ?? "ctm365_hvac_telemetry",
  config: process.env.CONFIG_TABLE ?? "ctm365_customer_config",
  analytics: process.env.ANALYTICS_TABLE ?? "ctm365_hvac_analytics",
  timeZone: process.env.TIME_ZONE ?? "America/Los_Angeles",
};

/** Days of history read for trends once the baseline is learned (findings use the last 7-14). */
const RECENT_DAYS = 20;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

/** "YYYY-MM-DD" for ts in the site's time zone. */
export function dayKey(ts, timeZone) {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone });
}

/** UTC ms of local midnight starting dayKey in timeZone (handles daylight saving). */
export function dayStart(key, timeZone) {
  const [y, m, d] = key.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const local = new Date(guess).toLocaleString("en-US", { timeZone, hourCycle: "h23" });
    const [datePart, timePart] = local.split(", ");
    const [mm, dd, yy] = datePart.split("/").map(Number);
    const [hh, mi] = timePart.split(":").map(Number);
    const shown = Date.UTC(yy, mm - 1, dd, hh, mi);
    guess += Date.UTC(y, m - 1, d) - shown;
  }
  return guess;
}

async function queryAll(input) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const out = await db.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...(out.Items ?? []));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function telemetryRows(unitId, from, to) {
  const items = await queryAll({
    TableName: env.telemetry,
    KeyConditionExpression: "hvac_unit_id = :u AND #ts BETWEEN :a AND :b",
    ExpressionAttributeNames: { "#ts": "timestamp" },
    ExpressionAttributeValues: { ":u": unitId, ":a": new Date(from).toISOString().slice(0, 17) + "00Z", ":b": new Date(to - 1).toISOString().slice(0, 17) + "00Z" },
  });
  return items.map(toRow).filter((r) => Number.isFinite(r.ts)).sort((a, b) => a.ts - b.ts);
}

async function hvacUnits() {
  const units = [];
  let ExclusiveStartKey;
  do {
    const out = await db.send(new ScanCommand({ TableName: env.config, ExclusiveStartKey }));
    for (const c of out.Items ?? []) {
      const on = c.services && typeof c.services.hvac === "boolean" ? c.services.hvac : (c.hvacUnits?.length ?? 0) > 0;
      if (!on) continue;
      for (const u of c.hvacUnits ?? []) units.push({ unitId: u.id, name: u.name, customerId: c.customer_id });
    }
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return units;
}

/** Cycle fields kept per day (the rest are only needed while classifying). */
const slimCycle = (c) => ({
  start: c.start, end: c.end, runMin: c.runMin, offBeforeMin: c.offBeforeMin, cause: c.cause, detail: c.detail,
  ampsRun: c.ampsRun, voltsMin: c.voltsMin, voltsAtStop: c.voltsAtStop, deltaTF: c.deltaTF, mode: c.mode,
});

/** Categories where a serious finding means the day shouldn't be learned as normal. */
const NOT_NORMAL = new Set(["cycling", "airflow", "capacity", "refrigerant"]);
const seriousDay = (d) => (d.findings ?? []).some((f) => NOT_NORMAL.has(f.category) && (f.level === "elevated" || f.level === "action"));

/**
 * Adds every finished day not yet learned (after any reset) to the baseline's
 * running records, in place. A day counts as finished once it has been
 * analysed after its own midnight. Returns how many days were added.
 */
export function learnFinishedDays(baseline, days, todayKey) {
  if (!baseline) return 0;
  let added = 0;
  baseline.dayMetrics ??= [];
  baseline.energyDays ??= [];
  for (const d of days) {
    if (d.day >= todayKey) continue;
    if (baseline.resetAt && d.day < baseline.resetAt) continue;
    if (baseline.lastLearnedDay && d.day <= baseline.lastLearnedDay) continue;
    const nextMidnight = dayStart(dayKey(dayStart(d.day, env.timeZone) + 36 * 3_600_000, env.timeZone), env.timeZone);
    if (!(Date.parse(d.computedAt) >= nextMidnight)) continue; // not final yet
    if (!seriousDay(d)) {
      baseline.dayMetrics.push({ day: d.day, metrics: d.metrics });
      if (d.refSamples?.length) baseline.refStats = addRefSamples(baseline.refStats ?? {}, d.refSamples);
      if (Number.isFinite(d.metrics?.kwh) && Number.isFinite(d.metrics?.cdd)) baseline.energyDays.push({ kwh: d.metrics.kwh, cdd: d.metrics.cdd });
    }
    baseline.lastLearnedDay = d.day;
    added++;
  }
  baseline.dayMetrics = baseline.dayMetrics.slice(-RULES.baselineHistoryDays);
  baseline.energyDays = baseline.energyDays.slice(-RULES.baselineHistoryDays);
  return added;
}

/** The unit's normal from its running records. */
export function rebuildBaseline(baseline) {
  return {
    ...buildBaseline(baseline?.dayMetrics ?? []),
    refrigerant: modelFromStats(baseline?.refStats ?? {}),
    energy: energyModel(baseline?.energyDays ?? []),
  };
}

export async function analyseUnit({ unitId, name, customerId }, now = Date.now()) {
  const todayKey = dayKey(now, env.timeZone);
  const yesterdayKey = dayKey(dayStart(todayKey, env.timeZone) - 1, env.timeZone);

  // Read only what this run needs, so cost stays flat as history grows: the
  // baseline (which carries compact running totals of everything learned) and
  // latest records, plus the last few weeks of days for trends.
  // Two direct reads: in sort-key order, "day#..." falls between "baseline" and "latest".
  const [baselineOut, latestOut] = await Promise.all(
    ["baseline", "latest"].map((sk) => db.send(new GetCommand({ TableName: env.analytics, Key: { unit_id: unitId, sk } }))),
  );
  let baseline = baselineOut.Item ?? { unit_id: unitId, sk: "baseline", customer_id: customerId };
  const previousLatest = latestOut.Item;
  const fromDay = dayKey(dayStart(todayKey, env.timeZone) - RECENT_DAYS * 86_400_000, env.timeZone);
  const days = (
    await queryAll({
      TableName: env.analytics,
      KeyConditionExpression: "unit_id = :u AND sk BETWEEN :a AND :b",
      ExpressionAttributeValues: { ":u": unitId, ":a": `day#${fromDay}`, ":b": `day#${todayKey}` },
    })
  ).sort((a, b) => a.sk.localeCompare(b.sk));
  const results = {};

  // Yesterday is re-checked once, on the first run after midnight (late data may
  // still have arrived); after that only today is analysed.
  const yesterdayDone = days.some((d) => d.day === yesterdayKey && Date.parse(d.computedAt) >= dayStart(todayKey, env.timeZone));
  const analysed = yesterdayDone ? [todayKey] : [yesterdayKey, todayKey];
  for (const key of analysed) {
    const from = dayStart(key, env.timeZone);
    const to = key === todayKey ? now : dayStart(todayKey, env.timeZone);
    const rows = await telemetryRows(unitId, from, to);
    const usable = baseline?.ready ? baseline : undefined;
    const day = dayMetrics(rows, usable);
    const recent = days.filter((d) => d.sk < `day#${key}`).slice(-7);
    const lastSeen = rows.length ? rows[rows.length - 1].ts : previousLatest?.lastSeen;
    const dayNow = key === todayKey ? now : to;
    const found = rows.length || key === todayKey ? findings({ today: day, recent, baseline: usable, lastSeen, now: dayNow }) : [];

    // Refrigerant side (needs the strap-on line probes and outdoor air) and weather-adjusted energy.
    const refSamples = refrigerantSamples(rows, day.cycles);
    const cdd = coolingDegreeDays(rows.map((r) => r.outdoorF));
    const recentIndex = days
      .filter((d) => d.sk < `day#${key}` && Number.isFinite(d.refResiduals?.chargeIndex))
      .slice(-13)
      .map((d, i) => ({ x: i, y: d.refResiduals.chargeIndex }));
    // The refrigerant and energy models have their own readiness (they need line probes / outdoor air).
    const ref = refrigerantFindings({ rows, cycles: day.cycles, samples: refSamples, model: baseline?.refrigerant, recentIndex });
    found.push(...ref.found);
    const energy = energyFinding(baseline?.energy, { kwh: day.metrics.kwh, cdd });
    if (energy) found.push(energy);
    results[key] = { day, found, lastSeen };

    const item = {
      unit_id: unitId, sk: `day#${key}`, customer_id: customerId, day: key,
      metrics: { ...day.metrics, cdd }, cycles: day.cycles.map(slimCycle), findings: found,
      refSamples, refResiduals: ref.residuals, computedAt: new Date(now).toISOString(),
    };
    if (rows.length) await db.send(new PutCommand({ TableName: env.analytics, Item: item }));
    const i = days.findIndex((d) => d.sk === item.sk);
    if (rows.length) {
      if (i >= 0) days[i] = item;
      else days.push(item);
    }
  }

  // Keep learning, always: every finished day is added once to the unit's
  // normal, unless something serious was found that day (so a developing
  // fault doesn't become "normal"). "Start learning again" clears it all.
  const learned = learnFinishedDays(baseline, days, todayKey);
  if (learned || !baseline?.metrics) {
    baseline = { ...baseline, ...rebuildBaseline(baseline), unit_id: unitId, sk: "baseline", customer_id: customerId, updatedAt: new Date(now).toISOString() };
    await db.send(new PutCommand({ TableName: env.analytics, Item: baseline }));
  }

  const today = results[todayKey];
  const h = health(today.found);
  await db.send(
    new PutCommand({
      TableName: env.analytics,
      Item: {
        unit_id: unitId, sk: "latest", customer_id: customerId, name,
        ...h, findings: today.found, metrics: today.day.metrics, lastSeen: today.lastSeen,
        baseline: {
          ready: baseline.ready, days: baseline.days, confidence: baseline.confidence, from: baseline.from, to: baseline.to, metrics: baseline.metrics,
          refrigerantModel: Boolean(baseline.refrigerant?.cooling || baseline.refrigerant?.heating),
          refrigerantConfidence: baseline.refrigerant?.cooling?.confidence ?? baseline.refrigerant?.heating?.confidence,
          refrigerantSamples: (baseline.refStats?.c?.n ?? 0) + (baseline.refStats?.h?.n ?? 0),
          energyModel: Boolean(baseline.energy),
        },
        refResiduals: results[todayKey] && days.find((d) => d.sk === `day#${todayKey}`)?.refResiduals,
        computedAt: new Date(now).toISOString(),
      },
    }),
  );
  return { unitId, analysed, status: h.status, score: h.score, findings: today.found.length, cycles: today.day.metrics.cycles, baselineDays: baseline.days };
}

export async function handler(event) {
  const wanted = Array.isArray(event?.unitIds) ? new Set(event.unitIds) : null;
  const units = (await hvacUnits()).filter((u) => !wanted || wanted.has(u.unitId));
  const out = [];
  for (const u of units) {
    try {
      out.push(await analyseUnit(u));
    } catch (err) {
      console.error(`[hvac-health] ${u.unitId} failed: ${err?.name}: ${err?.message}`);
      out.push({ unitId: u.unitId, error: err?.name ?? "Error" });
    }
  }
  console.info(`[hvac-health] ${JSON.stringify(out)}`);
  return out;
}
