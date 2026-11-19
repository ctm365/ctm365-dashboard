/**
 * HVAC health analytics: pure functions, no AWS calls (index.mjs does I/O).
 *
 * Input is the 1-minute rows from ctm365_hvac_telemetry. From them we:
 *  1. find compressor run cycles from the current,
 *  2. classify why each cycle stopped (normal, power problem, short cycle
 *     with a likely cause, start attempt, data gap),
 *  3. roll each day into metrics,
 *  4. learn the unit's own baseline from its first qualifying days,
 *  5. turn today vs baseline into findings with Good / Watch / Elevated /
 *     Action levels, a reason, and a recommended action.
 *
 * 1-minute data limits what we can see: inrush spikes and sub-minute voltage
 * sags are averaged away, and without the thermostat call (Y) a short run
 * could be a quick normal stop. Findings are worded as "likely" for that reason.
 */

export const RULES = {
  /** Below this the compressor is treated as off, until the unit has a baseline. */
  minRunAmps: 2,
  /** A run shorter than this is a short cycle. */
  shortRunMin: 5,
  /** Rows further apart than this are a gap in the data. */
  gapMin: 3,
  /** Voltage band as a fraction of the unit's normal voltage (Bard 208/230 V units run 197-253 V). */
  voltageLow: 0.9,
  voltageHigh: 1.1,
  /** A drop this large from the cycle's median voltage at the stop counts as a sag. */
  sagFraction: 0.08,
  /** Days with at least this much compressor runtime count toward the baseline. */
  baselineMinRuntimeMin: 60,
  baselineDaysNeeded: 7,
  baselineDaysMax: 14,
  /** Static pressure rating ceiling for the Bard W42HC (in. w.c.). */
  staticMaxInwc: 0.5,
};

const LEVELS = ["good", "watch", "elevated", "action"];
export const LEVEL_WEIGHT = { good: 0, watch: 5, elevated: 15, action: 30 };
export const CATEGORIES = ["cycling", "electrical", "airflow", "capacity", "data"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return undefined;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const minOf = (values) => {
  const v = values.filter(Number.isFinite);
  return v.length ? Math.min(...v) : undefined;
};
const maxOf = (values) => {
  const v = values.filter(Number.isFinite);
  return v.length ? Math.max(...v) : undefined;
};

const round = (v, d = 2) => (v === undefined ? undefined : Math.round(v * 10 ** d) / 10 ** d);

/** One telemetry item to a compact minute row. Unit IDs and keys match the ingest Lambda. */
export function toRow(item) {
  const ts = typeof item.timestamp === "string" ? Date.parse(item.timestamp) : num(item.ts);
  const phases = [num(item.current_a_a), num(item.current_b_a), num(item.current_c_a)];
  const amps = num(item.current_a) ?? (phases.some((p) => p !== undefined) ? Math.max(...phases.filter((p) => p !== undefined)) : undefined);
  const meter = amps !== undefined || num(item.voltage_v) !== undefined || num(item.voltage_an_v) !== undefined;
  return {
    ts,
    amps,
    phases,
    // Line-to-line is the unit's supply voltage on 208/230 V; fall back to line-to-neutral.
    volts: num(item.voltage_v) ?? num(item.voltage_ab_v) ?? num(item.voltage_an_v),
    powerW: num(item.power_w),
    pf: num(item.power_factor),
    supplyF: num(item.air_supply_temp_f),
    returnF: num(item.air_return_temp_f),
    staticInwc: num(item.static_pressure_inwc),
    energyKwh: num(item.energy_kwh),
    meter,
  };
}

/** Compressor-on threshold: half the unit's normal running amps once known, else a fixed floor. */
export function runThreshold(baseline) {
  const normal = baseline?.metrics?.ampsRun;
  return normal ? Math.max(RULES.minRunAmps, normal * 0.5) : RULES.minRunAmps;
}

/** Phase imbalance in percent across phases that carry current. */
function imbalancePct(phases) {
  const live = phases.filter((p) => p !== undefined && p > 0.5);
  if (live.length < 2) return undefined;
  const avg = live.reduce((a, b) => a + b, 0) / live.length;
  return ((Math.max(...live) - Math.min(...live)) / avg) * 100;
}

/**
 * Finds run cycles in time-ordered minute rows. A cycle is consecutive
 * minutes at or above the run threshold; a gap in the data ends a cycle.
 */
export function findCycles(rows, threshold) {
  const cycles = [];
  let current = null;
  let lastEnd = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const prev = rows[i - 1];
    const gapBefore = prev ? (r.ts - prev.ts) / 60_000 > RULES.gapMin : false;
    const on = r.amps !== undefined && r.amps >= threshold;

    if (current && (gapBefore || !on)) {
      current.endIdx = i - 1;
      current.stopGap = gapBefore;
      current.stopMeterLost = gapBefore ? false : !r.meter && (r.supplyF !== undefined || r.returnF !== undefined);
      cycles.push(current);
      lastEnd = rows[i - 1].ts + 60_000;
      current = null;
    }
    if (on && !current) {
      current = { startIdx: i, offBeforeMin: lastEnd === null || gapBefore ? undefined : (r.ts - lastEnd) / 60_000 };
    }
  }
  if (current) {
    current.endIdx = rows.length - 1;
    current.open = true; // still running at the end of the data
    cycles.push(current);
  }
  return cycles.map((c) => describeCycle(rows, c));
}

function describeCycle(rows, c) {
  const run = rows.slice(c.startIdx, c.endIdx + 1);
  const runMin = run.length;
  // Edge minutes are part-on averages; use interior minutes when there are enough.
  const interior = runMin >= 3 ? run.slice(1, -1) : run;
  const settled = runMin >= 5 ? run.slice(3) : run.slice(-1);
  const ampsRun = median(interior.map((r) => r.amps));
  const firstAmps = median(interior.slice(0, 2).map((r) => r.amps));
  const lastAmps = median(interior.slice(-2).map((r) => r.amps));
  const voltsMedian = median(run.map((r) => r.volts));
  const last = run[run.length - 1];
  const after = rows[c.endIdx + 1];
  const deltas = settled.map((r) => (r.returnF !== undefined && r.supplyF !== undefined ? r.returnF - r.supplyF : undefined));
  const dt = median(deltas);
  return {
    start: run[0].ts,
    end: last.ts + 60_000,
    runMin,
    offBeforeMin: c.offBeforeMin,
    open: Boolean(c.open),
    ampsRun: round(ampsRun),
    ampsPeak: round(maxOf(interior.map((r) => r.amps))),
    ampsTrend: firstAmps && lastAmps ? round((lastAmps - firstAmps) / firstAmps, 3) : undefined,
    voltsMedian: round(voltsMedian, 1),
    voltsMin: round(minOf(run.map((r) => r.volts)), 1),
    voltsMax: round(maxOf(run.map((r) => r.volts)), 1),
    voltsAtStop: round(last.volts, 1),
    voltsAfterStop: round(after?.volts, 1),
    deltaTF: round(dt === undefined ? undefined : Math.abs(dt), 1),
    mode: dt === undefined ? undefined : dt >= 0 ? "cooling" : "heating",
    staticInwc: round(median(settled.map((r) => r.staticInwc)), 3),
    pf: round(median(interior.map((r) => r.pf)), 3),
    imbalancePct: round(median(interior.map((r) => imbalancePct(r.phases))), 1),
    kwPerDegF: round(median(settled.map((r, i) => (r.powerW !== undefined && deltas[i] ? r.powerW / 1000 / Math.abs(deltas[i]) : undefined))), 3),
    stopGap: Boolean(c.stopGap),
    stopMeterLost: Boolean(c.stopMeterLost),
  };
}

/** Normal supply voltage for the unit: its baseline if known, else this data's median. */
function nominalVolts(rows, baseline) {
  return baseline?.metrics?.volts ?? median(rows.map((r) => r.volts));
}

/**
 * Why did this cycle stop? Returns { cause, detail }.
 * cause: normal | running | power | meter-power-loss | data-gap |
 *        start-attempt | short-overload | short-low-charge | short-cycle
 */
export function classifyStop(cycle, nominal, baseline) {
  if (cycle.open) return { cause: "running", detail: "Still running at the end of the data." };
  if (cycle.stopMeterLost) {
    return { cause: "meter-power-loss", detail: "The power meter lost its supply as the unit stopped: a power outage or a tripped breaker, not a unit fault." };
  }
  if (cycle.stopGap) return { cause: "data-gap", detail: "Data stopped while the unit was running, so the reason it stopped is unknown." };

  const low = nominal ? nominal * RULES.voltageLow : undefined;
  const high = nominal ? nominal * RULES.voltageHigh : undefined;
  const v = [cycle.voltsAtStop, cycle.voltsAfterStop, cycle.voltsMin, cycle.voltsMax].filter(Number.isFinite);
  const outOfRange = nominal !== undefined && v.some((x) => x < low || x > high);
  const sag = cycle.voltsMedian && cycle.voltsAtStop !== undefined && cycle.voltsAtStop < cycle.voltsMedian * (1 - RULES.sagFraction);
  if (outOfRange || sag) {
    const worst = v.reduce((a, b) => (Math.abs(b - nominal) > Math.abs(a - nominal) ? b : a), v[0]);
    return {
      cause: "power",
      detail: `Supply voltage was ${worst?.toFixed(0)} V around the stop (normal about ${nominal?.toFixed(0)} V). The unit likely shut off on bad power, not a fault in the unit.`,
    };
  }

  if (cycle.runMin <= 1) {
    return { cause: "start-attempt", detail: "Ran for about a minute or less: a start attempt that didn't keep running." };
  }
  if (cycle.runMin < RULES.shortRunMin) {
    const normalAmps = baseline?.metrics?.ampsRun;
    const normalDt = baseline?.metrics?.deltaTF;
    if ((cycle.ampsTrend ?? 0) > 0.15 || (normalAmps && (cycle.ampsPeak ?? cycle.ampsRun) > normalAmps * 1.2)) {
      return { cause: "short-overload", detail: "Current climbed above normal before it stopped: likely a high-pressure or overload trip." };
    }
    if (normalAmps && normalDt && cycle.ampsRun < normalAmps * 0.85 && (cycle.deltaTF ?? 0) < normalDt * 0.7) {
      return { cause: "short-low-charge", detail: "Low current and a weak temperature drop before it stopped: a pattern seen with low refrigerant." };
    }
    return { cause: "short-cycle", detail: `Ran only ${cycle.runMin} minutes with normal current and voltage.` };
  }
  return { cause: "normal", detail: "Normal run." };
}

/** Rolls one day's rows into cycles and metrics. rows must be time-ordered. */
export function dayMetrics(rows, baseline) {
  const threshold = runThreshold(baseline);
  const nominal = nominalVolts(rows, baseline);
  const cycles = findCycles(rows, threshold).map((c) => ({ ...c, ...classifyStop(c, nominal, baseline) }));
  const done = cycles.filter((c) => !c.open);

  // Most starts in any clock hour.
  const perHour = new Map();
  for (const c of cycles) {
    const h = Math.floor(c.start / 3_600_000);
    perHour.set(h, (perHour.get(h) ?? 0) + 1);
  }

  const runRows = rows.filter((r) => r.amps !== undefined && r.amps >= threshold);
  const volts = rows.map((r) => r.volts).filter(Number.isFinite);
  const energies = rows.map((r) => r.energyKwh).filter(Number.isFinite);
  const count = (cause) => done.filter((c) => c.cause === cause).length;
  const longRuns = cycles.filter((c) => c.runMin >= RULES.shortRunMin);

  return {
    metrics: {
      rows: rows.length,
      runtimeMin: runRows.length,
      cycles: cycles.length,
      maxCyclesPerHour: Math.max(0, ...perHour.values()),
      shortCycles: done.filter((c) => c.cause.startsWith("short-") || c.cause === "start-attempt").length,
      startAttempts: count("start-attempt"),
      overloadStops: count("short-overload"),
      lowChargeStops: count("short-low-charge"),
      powerStops: count("power") + count("meter-power-loss"),
      dataGapStops: count("data-gap"),
      avgRunMin: round(median(done.map((c) => c.runMin)), 1),
      ampsRun: round(median(longRuns.map((c) => c.ampsRun))),
      deltaTF: round(median(longRuns.map((c) => c.deltaTF)), 1),
      mode: longRuns.length ? (longRuns.filter((c) => c.mode === "heating").length > longRuns.length / 2 ? "heating" : "cooling") : undefined,
      staticInwc: round(median(longRuns.map((c) => c.staticInwc)), 3),
      pf: round(median(longRuns.map((c) => c.pf)), 3),
      imbalancePct: round(median(longRuns.map((c) => c.imbalancePct)), 1),
      kwPerDegF: round(median(longRuns.map((c) => c.kwPerDegF)), 3),
      volts: round(median(volts), 1),
      voltsMin: volts.length ? round(Math.min(...volts), 1) : undefined,
      voltsMax: volts.length ? round(Math.max(...volts), 1) : undefined,
      minutesOutOfRange: nominal ? volts.filter((v) => v < nominal * RULES.voltageLow || v > nominal * RULES.voltageHigh).length : 0,
      kwh: energies.length >= 2 ? round(Math.max(0, energies[energies.length - 1] - energies[0]), 2) : round(rows.reduce((a, r) => a + (r.powerW ?? 0) / 60_000, 0), 2),
      lastTs: rows.length ? rows[rows.length - 1].ts : undefined,
    },
    cycles,
  };
}

/**
 * The unit's normal, from its first qualifying days (median of each metric).
 * days: [{ day: "2026-11-19", metrics }] oldest first. Ready after 7 qualifying
 * days; frozen at 14 so slow wear stays visible against the original normal.
 */
export function buildBaseline(days) {
  const qualifying = days.filter((d) => (d.metrics.runtimeMin ?? 0) >= RULES.baselineMinRuntimeMin).slice(0, RULES.baselineDaysMax);
  const pick = (k) => round(median(qualifying.map((d) => d.metrics[k])), 3);
  return {
    ready: qualifying.length >= RULES.baselineDaysNeeded,
    days: qualifying.length,
    from: qualifying[0]?.day,
    to: qualifying[qualifying.length - 1]?.day,
    metrics: {
      ampsRun: pick("ampsRun"),
      deltaTF: pick("deltaTF"),
      staticInwc: pick("staticInwc"),
      pf: pick("pf"),
      kwPerDegF: pick("kwPerDegF"),
      volts: pick("volts"),
      avgRunMin: pick("avgRunMin"),
      maxCyclesPerHour: pick("maxCyclesPerHour"),
    },
  };
}

const pct = (now, base) => (now !== undefined && base ? (now - base) / base : undefined);
const fmtPct = (x) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;

/**
 * Findings for a unit from today's metrics (and the last 7 days for trends)
 * against its baseline. Each finding: { category, level, code, title, detail, action }.
 */
export function findings({ today, recent = [], baseline, lastSeen, now }) {
  const f = [];
  const add = (category, level, code, title, detail, action) => f.push({ category, level, code, title, detail, action });
  const m = today?.metrics ?? {};
  const b = baseline?.ready ? baseline.metrics : undefined;

  // Data: is the unit reporting at all?
  if (!lastSeen || now - lastSeen > 3 * 3_600_000) {
    add("data", "action", "offline", "No data from this unit", lastSeen ? `Last reading ${Math.round((now - lastSeen) / 3_600_000)} hours ago.` : "No readings yet.", "Check the gateway's power and cellular signal, and the unit's breaker.");
  } else if (now - lastSeen > 20 * 60_000) {
    add("data", "watch", "delayed", "Data delayed", `Last reading ${Math.round((now - lastSeen) / 60_000)} minutes ago.`, "Usually a brief cellular drop; check the gateway if it persists.");
  }

  // Cycling.
  if (m.startAttempts >= 3) {
    add("cycling", "action", "start-attempts", "Repeated start attempts", `${m.startAttempts} starts today ran a minute or less.`, "Check the run capacitor, contactor and compressor; consider a hard-start kit.");
  }
  if (m.overloadStops >= 3) {
    add("cycling", "action", "overload-trips", "Shutting off on high load", `${m.overloadStops} short runs today ended with current climbing above normal.`, "Check condenser coil cleanliness, condenser fan, and refrigerant charge (possible overcharge).");
  } else if (m.overloadStops >= 1) {
    add("cycling", "watch", "overload-trips", "Occasional high-load shutoff", `${m.overloadStops} short run today ended with current climbing.`, "Inspect the condenser coil and fan at the next visit.");
  }
  if (m.lowChargeStops >= 3) {
    add("capacity", "elevated", "low-charge-pattern", "Possible low refrigerant", `${m.lowChargeStops} short runs today had low current and a weak temperature drop.`, "Check refrigerant charge and look for leaks.");
  }
  if (m.maxCyclesPerHour >= 8 || m.shortCycles >= 12) {
    add("cycling", "action", "short-cycling", "Severe short cycling", `${m.shortCycles} short cycles today, up to ${m.maxCyclesPerHour} starts in one hour (6 or more per hour wears the compressor).`, "Find the cause soon: check thermostat location and settings, refrigerant charge, and airflow.");
  } else if (m.maxCyclesPerHour >= 6 || m.shortCycles >= 6) {
    add("cycling", "elevated", "short-cycling", "Short cycling", `${m.shortCycles} short cycles today, up to ${m.maxCyclesPerHour} starts in one hour.`, "Check thermostat settings and location, and airflow, at the next visit.");
  } else if (m.shortCycles >= 3) {
    add("cycling", "watch", "short-cycling", "Some short cycles", `${m.shortCycles} short cycles today.`, "Keep an eye on it; no action needed yet.");
  }

  // Electrical.
  if (m.powerStops >= 1) {
    add("electrical", m.powerStops >= 3 ? "elevated" : "watch", "power-stops", "Shut off by power problems", `${m.powerStops} shutdown${m.powerStops === 1 ? "" : "s"} today happened with the supply voltage out of range or lost. These are power issues, not unit faults.`, "Have the building's electrician or utility check the supply to this unit.");
  }
  if (m.minutesOutOfRange > 30) {
    add("electrical", "elevated", "voltage-range", "Supply voltage out of range", `${m.minutesOutOfRange} minutes today outside ±10% of normal (${m.voltsMin}-${m.voltsMax} V).`, "Check the supply voltage at the disconnect; out-of-range voltage overheats the compressor.");
  } else if (m.minutesOutOfRange > 0) {
    add("electrical", "watch", "voltage-range", "Brief voltage excursions", `${m.minutesOutOfRange} minutes today outside ±10% of normal.`, "No action unless it repeats.");
  }
  if (m.imbalancePct > 20) {
    add("electrical", "action", "imbalance", "Severe current imbalance", `Phase currents differ by ${m.imbalancePct}% while running.`, "Check for a loose connection, failing contactor, or winding damage.");
  } else if (m.imbalancePct > 10) {
    add("electrical", "elevated", "imbalance", "Current imbalance", `Phase currents differ by ${m.imbalancePct}% while running (over 10% is a concern).`, "Check terminals and the contactor at the next visit.");
  }
  if (b) {
    const amps = pct(m.ampsRun, b.ampsRun);
    const pfDrop = m.pf !== undefined && b.pf ? b.pf - m.pf : undefined;
    if (amps !== undefined && amps > 0.15 && pfDrop !== undefined && pfDrop > 0.05) {
      add("electrical", "elevated", "capacitor", "Signs of a weakening run capacitor", `Running current ${fmtPct(amps)} and power factor down ${pfDrop.toFixed(2)} versus this unit's normal.`, "Test the run capacitor; replacing it early prevents compressor damage.");
    } else if (amps !== undefined && amps > 0.25) {
      add("electrical", "elevated", "high-amps", "Drawing more current than normal", `Running current ${fmtPct(amps)} versus this unit's normal ${b.ampsRun} A.`, "Check condenser coil, refrigerant charge and capacitor.");
    } else if (amps !== undefined && amps > 0.15) {
      add("electrical", "watch", "high-amps", "Current trending up", `Running current ${fmtPct(amps)} versus normal.`, "Check at the next scheduled visit.");
    }
  }

  // Airflow.
  if (m.staticInwc !== undefined && m.staticInwc > RULES.staticMaxInwc) {
    add("airflow", "elevated", "static-high", "Static pressure above the unit's rating", `${m.staticInwc} in. w.c. while running (rated up to ${RULES.staticMaxInwc}).`, "Replace the filter and check the indoor coil and ductwork.");
  } else if (b && m.staticInwc !== undefined && b.staticInwc) {
    const s = pct(m.staticInwc, b.staticInwc);
    if (s > 0.5) add("airflow", "elevated", "static-rising", "Airflow restriction", `Static pressure ${fmtPct(s)} versus normal.`, "Replace the filter; if that doesn't fix it, check the indoor coil.");
    else if (s > 0.25) add("airflow", "watch", "static-rising", "Filter loading", `Static pressure ${fmtPct(s)} versus normal.`, "Plan a filter change.");
    else if (s < -0.5) add("airflow", "watch", "static-low", "Static pressure unusually low", `Static pressure ${fmtPct(s)} versus normal.`, "Check the blower, belt, and for a disconnected duct or missing filter.");
  }

  // Capacity and efficiency, compared only in the same mode as the baseline.
  if (b && m.deltaTF !== undefined && b.deltaTF && m.runtimeMin >= RULES.baselineMinRuntimeMin) {
    const d = pct(m.deltaTF, b.deltaTF);
    if (d < -0.35) add("capacity", "elevated", "deltat-low", "Losing capacity", `Temperature drop across the unit ${fmtPct(d)} versus normal (${m.deltaTF}°F vs ${b.deltaTF}°F).`, "Check refrigerant charge, coil cleanliness and airflow.");
    else if (d < -0.2) add("capacity", "watch", "deltat-low", "Capacity slipping", `Temperature drop ${fmtPct(d)} versus normal.`, "Check at the next scheduled visit.");
    const k = pct(m.kwPerDegF, b.kwPerDegF);
    if (k !== undefined && k > 0.2) add("capacity", "watch", "efficiency", "Using more power for the same work", `Power per degree of temperature change ${fmtPct(k)} versus normal.`, "Usually a dirty coil or charge problem; check at the next visit.");
  }

  // Sustained trend: the same problem on most of the last 7 days raises its level by one.
  const recentCodes = recent.flatMap((d) => (d.findings ?? []).map((x) => x.code));
  for (const x of f) {
    const days = recentCodes.filter((c) => c === x.code).length;
    if (days >= 5 && x.level !== "action" && x.category !== "data") {
      x.level = LEVELS[LEVELS.indexOf(x.level) + 1];
      x.detail += ` Seen on ${days} of the last 7 days.`;
    }
  }
  return f;
}

/** Overall and per-category status plus a 0-100 score. */
export function health(found) {
  const worst = (list) => list.reduce((w, x) => (LEVELS.indexOf(x.level) > LEVELS.indexOf(w) ? x.level : w), "good");
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, worst(found.filter((x) => x.category === c))]));
  const score = Math.max(0, 100 - found.reduce((s, x) => s + LEVEL_WEIGHT[x.level], 0));
  return { status: worst(found), score, categories };
}
