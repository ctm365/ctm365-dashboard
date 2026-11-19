/**
 * Refrigerant-side health without opening the refrigerant circuit, the same
 * idea as Thalo's Sidekick: strap-on suction and discharge line temperatures
 * plus compressor power, read against what this unit normally does in the
 * same outdoor and indoor conditions.
 *
 * During the baseline period we fit, per unit and mode (cooling/heating):
 *     expected(y) = a + b * outdoorF + c * returnF
 * for y in suction line temp, discharge line temp, compressor kW and air ΔT.
 * Afterwards each running minute's reading minus its expected value is a
 * residual; each day's median residual, in units of that measure's normal
 * scatter, forms a pattern that we match against known fault signatures.
 *
 * This is inference, not a refrigerant pressure reading: findings say
 * "pattern consistent with", and a tech confirms with gauges.
 * Pure functions; no AWS calls.
 */

export const TARGETS = ["slt", "dlt", "kw", "dt"];

export const REF_RULES = {
  /** Minutes into a run before readings count (lines take a few minutes to settle). */
  settleMin: 5,
  /** Keep every Nth settled minute per day, to bound storage. */
  sampleEvery: 3,
  /** Samples and outdoor range needed before outdoor temperature gets its own term. */
  minSamples: 300,
  minOutdoorRangeF: 10,
  /**
   * Signature matching. Pattern strength is the size of the day's residuals in
   * units of normal scatter. Roughly, for low charge: ~15% charge lost is a
   * watch, ~20% elevated, ~30% or more an action.
   */
  minMagnitude: 2.5,
  minSimilarity: 0.8,
  elevatedMagnitude: 4.5,
  actionMagnitude: 7,
  /**
   * Smallest "normal scatter" per measure, close to field reality (sensor
   * mounting, load swings), so a very steady learning period can't make tiny
   * changes look large: suction ±1.5°F, discharge ±3°F, ±0.1 kW, ΔT ±1°F.
   */
  scatterFloor: { slt: 1.5, dlt: 3, kw: 0.1, dt: 1 },
  /** Compressor discharge line limits (°F), measured within ~6 in. of the compressor. */
  dltElevatedF: 225,
  dltActionF: 250,
  /** Suction line at or below this while cooling means the indoor coil is near freezing. */
  freezeF: 32,
  freezeMinutes: 30,
  /** Discharge minus suction this small while running means the compressor isn't pumping. */
  minLiftF: 30,
};

/**
 * Expected direction of each residual (suction, discharge, kW, ΔT) for each
 * fault in cooling mode. 0 means "no strong effect".
 */
export const SIGNATURES = {
  "low-charge": {
    vector: [1, 1, -1, -1],
    title: "Pattern consistent with low refrigerant charge",
    detail: "Suction and discharge lines are running warmer than normal while the compressor draws less power and cools less: the classic undercharge pattern.",
    action: "Leak-check the unit and verify charge with gauges (superheat/subcooling). Compressor valve wear can look similar.",
  },
  overcharge: {
    vector: [-1, 0.5, 1, -0.5],
    title: "Pattern consistent with overcharge",
    detail: "The suction line is colder than normal while the compressor draws more power.",
    action: "Verify charge with gauges; check that the metering device isn't stuck open.",
  },
  "low-airflow": {
    vector: [-1, -0.5, -0.5, 1],
    title: "Pattern consistent with low indoor airflow",
    detail: "A colder suction line and a larger temperature drop than normal with less compressor load: air isn't moving through the indoor coil as it should.",
    action: "Check the filter, indoor coil, blower and belt. Low airflow can freeze the coil.",
  },
  condenser: {
    vector: [0, 1, 1, -0.5],
    title: "Pattern consistent with a condenser problem",
    detail: "The compressor draws more power and runs hotter than normal for the outdoor temperature.",
    action: "Clean the condenser coil and check the condenser fan motor and capacitor.",
  },
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Settled running minutes as compact samples [oat, rat, slt, dlt, kw, dt, mode]. */
export function refrigerantSamples(rows, cycles, { outdoorF } = {}) {
  const out = [];
  for (const c of cycles) {
    const from = c.start + REF_RULES.settleMin * 60_000;
    let n = 0;
    for (const r of rows) {
      if (r.ts < from || r.ts >= c.end) continue;
      if (n++ % REF_RULES.sampleEvery) continue;
      const oat = num(r.outdoorF) ?? (typeof outdoorF === "function" ? outdoorF(r.ts) : undefined);
      const dt = r.returnF !== undefined && r.supplyF !== undefined ? r.returnF - r.supplyF : undefined;
      if (oat === undefined || r.returnF === undefined || r.sltF === undefined || r.dltF === undefined || r.powerW === undefined || dt === undefined) continue;
      out.push([oat, r.returnF, r.sltF, r.dltF, r.powerW / 1000, Math.abs(dt), dt >= 0 ? "c" : "h"]);
    }
  }
  return out;
}

/** Least squares with a tiny ridge term, on centred features, for numerical safety. */
function fit(xs, ys) {
  const n = ys.length;
  const k = xs[0].length;
  const mx = Array.from({ length: k }, (_, j) => xs.reduce((s, x) => s + x[j], 0) / n);
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const A = Array.from({ length: k }, () => Array(k).fill(0));
  const v = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const xc = xs[i].map((x, j) => x - mx[j]);
    for (let a = 0; a < k; a++) {
      v[a] += xc[a] * (ys[i] - my);
      for (let b = 0; b < k; b++) A[a][b] += xc[a] * xc[b];
    }
  }
  for (let a = 0; a < k; a++) A[a][a] += 1e-6 * n + 1e-9;
  // Solve A w = v (k is 1 or 2).
  let w;
  if (k === 1) w = [v[0] / A[0][0]];
  else {
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    w = [(v[0] * A[1][1] - v[1] * A[0][1]) / det, (A[0][0] * v[1] - A[1][0] * v[0]) / det];
  }
  const intercept = my - w.reduce((s, wj, j) => s + wj * mx[j], 0);
  return { intercept, slopes: w };
}

const mad = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const dev = s.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  return 1.4826 * dev[Math.floor(dev.length / 2)];
};

/**
 * Fits the unit's normal refrigerant behaviour from baseline samples.
 * Returns { cooling?, heating? }, each { terms, coef: {slt,dlt,kw,dt}, scatter, samples }.
 */
export function buildRefrigerantModel(samples) {
  const model = {};
  for (const [mode, key] of [["c", "cooling"], ["h", "heating"]]) {
    const s = samples.filter((x) => x[6] === mode);
    if (s.length < REF_RULES.minSamples) continue;
    const oats = s.map((x) => x[0]);
    const useOutdoor = Math.max(...oats) - Math.min(...oats) >= REF_RULES.minOutdoorRangeF;
    const rats = s.map((x) => x[1]);
    const useReturn = Math.max(...rats) - Math.min(...rats) >= 3;
    const terms = [useOutdoor && "outdoor", useReturn && "return"].filter(Boolean);
    const xs = s.map((x) => [useOutdoor ? x[0] : null, useReturn ? x[1] : null].filter((v) => v !== null));
    const coef = {};
    const scatter = {};
    TARGETS.forEach((t, i) => {
      const ys = s.map((x) => x[2 + i]);
      const mean = { intercept: ys.reduce((a, b) => a + b, 0) / ys.length, slopes: [] };
      let f = terms.length ? fit(xs, ys) : mean;
      // DynamoDB can't store NaN; if the terms can't be separated, fall back to the plain average.
      if (![f.intercept, ...f.slopes].every(Number.isFinite)) f = { intercept: mean.intercept, slopes: f.slopes.map(() => 0) };
      coef[t] = f;
      const resid = s.map((x, n) => ys[n] - predictOne(f, xs[n]));
      // Floor the scatter so a very steady baseline doesn't turn tiny changes into big scores.
      scatter[t] = Math.max(mad(resid), REF_RULES.scatterFloor[t]);
    });
    model[key] = { terms, coef, scatter, samples: s.length };
  }
  return model;
}

function predictOne(f, x) {
  return f.intercept + f.slopes.reduce((s, w, j) => s + w * x[j], 0);
}

function featuresFor(m, sample) {
  return [m.terms.includes("outdoor") ? sample[0] : null, m.terms.includes("return") ? sample[1] : null].filter((v) => v !== null);
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : undefined;
};

/** Today's median residual per measure, in units of normal scatter (a z-like score). */
export function dayResiduals(model, samples, mode = "cooling") {
  const m = model?.[mode];
  const s = samples.filter((x) => x[6] === (mode === "cooling" ? "c" : "h"));
  if (!m || s.length < 20) return undefined;
  const z = {};
  TARGETS.forEach((t, i) => {
    const resid = s.map((x) => x[2 + i] - predictOne(m.coef[t], featuresFor(m, x)));
    z[t] = Math.round((median(resid) / m.scatter[t]) * 100) / 100;
  });
  return { z, samples: s.length };
}

/** Best-matching fault signature for a residual pattern, if any. */
export function matchSignature(z) {
  const v = TARGETS.map((t) => z[t] ?? 0);
  const mag = Math.hypot(...v);
  if (mag < REF_RULES.minMagnitude) return undefined;
  let best;
  for (const [code, sig] of Object.entries(SIGNATURES)) {
    const s = sig.vector;
    const sim = v.reduce((a, x, i) => a + x * s[i], 0) / (mag * Math.hypot(...s));
    if (!best || sim > best.similarity) best = { code, similarity: Math.round(sim * 100) / 100, magnitude: Math.round(mag * 100) / 100 };
  }
  return best.similarity >= REF_RULES.minSimilarity ? best : undefined;
}

/** How strongly a day looks like low charge (projection onto that signature). Tracked as a trend. */
export function chargeIndex(z) {
  const s = SIGNATURES["low-charge"].vector;
  const len = Math.hypot(...s);
  return Math.round((TARGETS.reduce((a, t, i) => a + (z[t] ?? 0) * s[i], 0) / len) * 100) / 100;
}

/** Slope per day of a series [{ day index, value }], least squares. */
export function slopePerDay(points) {
  if (points.length < 2) return 0;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return sxx ? points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx : 0;
}

/** Absolute line-temperature limits, which need no baseline. */
export function lineLimits(rows, cycles) {
  const out = [];
  const running = (r) => cycles.some((c) => r.ts >= c.start + REF_RULES.settleMin * 60_000 && r.ts < c.end);
  const settled = rows.filter(running);
  const dlts = settled.map((r) => r.dltF).filter((v) => v !== undefined);
  const maxDlt = dlts.length ? Math.max(...dlts) : undefined;
  if (maxDlt !== undefined && maxDlt >= REF_RULES.dltActionF) {
    out.push({ category: "refrigerant", level: "action", code: "dlt-high", title: "Compressor running very hot", detail: `Discharge line reached ${Math.round(maxDlt)}°F (over ${REF_RULES.dltActionF}°F risks breaking down the compressor oil).`, action: "Check charge, condenser airflow and compressor now; continued running can damage the compressor." });
  } else if (maxDlt !== undefined && maxDlt >= REF_RULES.dltElevatedF) {
    out.push({ category: "refrigerant", level: "elevated", code: "dlt-high", title: "Compressor running hot", detail: `Discharge line reached ${Math.round(maxDlt)}°F (normal is usually under ${REF_RULES.dltElevatedF}°F).`, action: "Check refrigerant charge and condenser coil and fan." });
  }
  const freezing = settled.filter((r) => r.sltF !== undefined && r.sltF <= REF_RULES.freezeF && r.returnF !== undefined && r.supplyF !== undefined && r.returnF > r.supplyF);
  if (freezing.length >= REF_RULES.freezeMinutes) {
    out.push({ category: "refrigerant", level: "elevated", code: "coil-freezing", title: "Indoor coil near freezing", detail: `Suction line at or below ${REF_RULES.freezeF}°F for ${freezing.length} minutes while cooling.`, action: "Check airflow (filter, blower) and refrigerant charge; a frozen coil blocks airflow and can flood the compressor." });
  }
  const lifts = settled.filter((r) => r.dltF !== undefined && r.sltF !== undefined).map((r) => r.dltF - r.sltF);
  const lift = median(lifts);
  if (lift !== undefined && lifts.length >= 10 && lift < REF_RULES.minLiftF) {
    out.push({ category: "refrigerant", level: "action", code: "no-compression", title: "Compressor may not be pumping", detail: `Discharge line is only ${Math.round(lift)}°F warmer than suction while running (normally 60°F or more).`, action: "Check the compressor (valves, reversing valve) and the contactor; the unit isn't moving heat." });
  }
  return out;
}

/**
 * Refrigerant findings for a day: absolute limits always; signatures and the
 * charge trend once the unit has a refrigerant model.
 * recentIndex: [{ x: day number, y: chargeIndex }] for the last ~14 days.
 */
export function refrigerantFindings({ rows, cycles, samples, model, recentIndex = [] }) {
  const found = lineLimits(rows, cycles);
  const day = dayResiduals(model, samples, "cooling");
  if (!day) return { found, residuals: undefined };

  const match = matchSignature(day.z);
  if (match) {
    const sig = SIGNATURES[match.code];
    const level = match.magnitude >= REF_RULES.actionMagnitude ? "action" : match.magnitude >= REF_RULES.elevatedMagnitude ? "elevated" : "watch";
    found.push({ category: "refrigerant", level, code: match.code, title: sig.title, detail: `${sig.detail} (pattern strength ${match.magnitude}, match ${Math.round(match.similarity * 100)}%.)`, action: sig.action });
  }

  const idx = chargeIndex(day.z);
  const series = [...recentIndex, { x: (recentIndex.at(-1)?.x ?? -1) + 1, y: idx }];
  const slope = slopePerDay(series);
  if (series.length >= 10 && slope > 0.1 && idx > 1 && !found.some((f) => f.code === "low-charge")) {
    found.push({ category: "refrigerant", level: "watch", code: "charge-drift", title: "Refrigerant charge may be drifting down", detail: `The low-charge pattern has grown steadily over the last ${series.length} days (about ${slope.toFixed(2)} per day). A slow leak looks like this.`, action: "Leak-check at the next visit before it becomes a no-cool call." });
  }
  return { found, residuals: { ...day.z, chargeIndex: idx } };
}

/**
 * Weather-adjusted energy: daily kWh against cooling degree-days (base 65°F),
 * the method in Thalo's published case study.
 * baselineDays / today: { kwh, cdd }
 */
export function energyModel(baselineDays) {
  const d = baselineDays.filter((x) => Number.isFinite(x.kwh) && Number.isFinite(x.cdd) && x.cdd > 0);
  if (d.length < 7) return undefined;
  const f = fit(d.map((x) => [x.cdd]), d.map((x) => x.kwh));
  if (!(f.slopes[0] > 0)) return undefined;
  return { intercept: f.intercept, perCdd: f.slopes[0], days: d.length };
}

export function energyFinding(model, today) {
  if (!model || !Number.isFinite(today.kwh) || !(today.cdd >= 5)) return undefined;
  const expected = model.intercept + model.perCdd * today.cdd;
  const over = (today.kwh - expected) / expected;
  if (over < 0.2) return undefined;
  return {
    category: "capacity",
    level: over >= 0.4 ? "elevated" : "watch",
    code: "energy-weather",
    title: "Using more energy than normal for the weather",
    detail: `${today.kwh.toFixed(1)} kWh today against about ${expected.toFixed(1)} kWh expected for ${today.cdd.toFixed(0)} cooling degree-days (+${Math.round(over * 100)}%).`,
    action: "Usually low charge, a dirty coil or a weak capacitor; check at the next visit.",
  };
}

/** Cooling degree-days (base 65°F) from a day's outdoor readings. */
export function coolingDegreeDays(outdoorTempsF) {
  const v = outdoorTempsF.filter(Number.isFinite);
  if (!v.length) return undefined;
  return Math.max(0, (Math.max(...v) + Math.min(...v)) / 2 - 65);
}
