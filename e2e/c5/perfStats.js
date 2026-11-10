/**
 * C5 lab-metric aggregation (used by c5-03-performance.e2e.js and c5/perfRecompute.mjs).
 *
 * Every metric is aggregated from ALL of its samples, independently of their
 * order. A sample is valid only when it is a finite number; anything else
 * (null, undefined, NaN, a string) is counted as missing. A verdict is PASS
 * only when every expected sample is valid and the p75 meets the target:
 * missing or insufficient evidence is INSUFFICIENT, never PASS. A page with no
 * scripted interaction has no INP sample by design: NOT_APPLICABLE.
 *
 * The earlier summarise() looked only at the first run: [null, 240, 260, 280,
 * 300] gave no INP summary at all, and the threshold assertion was skipped.
 */

/** Doc 16 PERF-002 to PERF-004 (field p75 targets, used as LAB gates). */
export const TARGETS = Object.freeze({ lcp: 2500, cls: 0.1, inp: 200 });

const isValid = (value) => typeof value === 'number' && Number.isFinite(value);

/** Nearest-rank percentile of an ascending array (p in 0..1). */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export function aggregate(values) {
  const samples = Array.isArray(values) ? values : [];
  const valid = samples.filter(isValid).sort((a, b) => a - b);
  const mid = Math.floor(valid.length / 2);
  return {
    samples: samples.length,
    valid: valid.length,
    missing: samples.length - valid.length,
    median: valid.length ? (valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2) : null,
    p75: percentile(valid, 0.75),
    max: valid.length ? valid[valid.length - 1] : null,
    min: valid.length ? valid[0] : null,
  };
}

/**
 * The verdict of an aggregate against a target.
 *   expected    the number of samples the evidence needs (the runs made);
 *   applicable  false when the page has no scripted interaction (INP only).
 */
export function verdict(agg, { target, expected, applicable = true }) {
  if (!applicable) return { status: 'NOT_APPLICABLE', reason: 'no scripted interaction on this page' };
  if (!agg || agg.valid === 0) return { status: 'INSUFFICIENT', reason: `no valid sample (${agg?.missing ?? 0} missing)` };
  if (agg.valid < expected || agg.missing > 0) return { status: 'INSUFFICIENT', reason: `${agg.valid} valid of ${expected} expected, ${agg.missing} missing` };
  return agg.p75 <= target
    ? { status: 'PASS', reason: `p75 ${agg.p75} <= ${target}` }
    : { status: 'FAIL', reason: `p75 ${agg.p75} > ${target}` };
}

/** Whether a run scripted any interaction (its INP sample is then expected). */
export const hasScriptedInteraction = (run) => Array.isArray(run.interactions) && run.interactions.length > 0;

/** The summary of one page/profile from its raw runs. */
export function summariseRuns(runs, { expected = runs.length } = {}) {
  const pick = (k) => runs.map((r) => r[k]);
  const interactive = runs.filter(hasScriptedInteraction);
  const inpApplicable = interactive.length > 0;
  const lcp = aggregate(pick('lcp'));
  const cls = aggregate(pick('cls'));
  // INP samples come only from runs that scripted interactions; a run that scripted them and recorded none is missing.
  const inp = inpApplicable ? aggregate(runs.map((r) => (hasScriptedInteraction(r) ? r.inp : null))) : aggregate([]);
  return {
    runs: runs.length,
    expected,
    lcp: { ...lcp, verdict: verdict(lcp, { target: TARGETS.lcp, expected }) },
    cls: { ...cls, verdict: verdict(cls, { target: TARGETS.cls, expected }) },
    inp: { ...inp, applicable: inpApplicable, verdict: verdict(inp, { target: TARGETS.inp, expected, applicable: inpApplicable }) },
    fcp: aggregate(pick('fcp')),
    ttfb: aggregate(pick('ttfb')),
    tbtAfterFcp: aggregate(pick('tbtAfterFcp')),
    totalKiB: aggregate(pick('totalKiB')),
    lcpElements: [...new Set(pick('lcpElement'))],
    transferKiB: runs[0]?.transferKiB ?? null,
    encodings: runs[0]?.encodings ?? null,
  };
}
