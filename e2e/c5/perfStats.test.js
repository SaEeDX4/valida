import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TARGETS, aggregate, summariseRuns, verdict } from './perfStats.js';

/** A raw run as c5-03-performance records it; `inp` null with interactions = an interaction that recorded nothing. */
const run = (inp, { lcp = 1000, cls = 0, interactions = ['tap'] } = {}) => ({ inp, lcp, cls, fcp: 900, ttfb: 10, tbtAfterFcp: 0, totalKiB: 300, lcpElement: 'h1', interactions });

describe('aggregate', () => {
  it('first sample missing: the other four are still aggregated (the reproduced defect)', () => {
    const a = aggregate([null, 240, 260, 280, 300]);
    assert.deepEqual({ samples: a.samples, valid: a.valid, missing: a.missing, p75: a.p75, max: a.max }, { samples: 5, valid: 4, missing: 1, p75: 280, max: 300 });
  });
  it('is independent of order', () => {
    const values = [300, 240, null, 280, 260];
    assert.deepEqual(aggregate(values), aggregate([null, 240, 260, 280, 300]));
    assert.deepEqual(aggregate([...values].reverse()), aggregate(values));
  });
  it('all missing: no statistic is invented', () => {
    const a = aggregate([null, undefined, Number.NaN, 'x', Infinity]);
    assert.deepEqual({ valid: a.valid, missing: a.missing, median: a.median, p75: a.p75, max: a.max }, { valid: 0, missing: 5, median: null, p75: null, max: null });
  });
  it('nearest-rank p75 and the median of five', () => {
    const a = aggregate([240, 260, 280, 300, 320]);
    assert.equal(a.p75, 300);
    assert.equal(a.median, 280);
  });
});

describe('verdict', () => {
  it('above target is FAIL', () => {
    assert.equal(verdict(aggregate([240, 260, 280, 300, 320]), { target: TARGETS.inp, expected: 5 }).status, 'FAIL');
  });
  it('within target with every sample valid is PASS', () => {
    assert.equal(verdict(aggregate([40, 48, 56, 64, 72]), { target: TARGETS.inp, expected: 5 }).status, 'PASS');
  });
  it('a missing sample is never PASS, even when the valid ones are within target', () => {
    const v = verdict(aggregate([null, 40, 48, 56, 64]), { target: TARGETS.inp, expected: 5 });
    assert.equal(v.status, 'INSUFFICIENT');
    assert.match(v.reason, /4 valid of 5 expected, 1 missing/);
  });
  it('all missing is INSUFFICIENT', () => {
    assert.equal(verdict(aggregate([null, null, null, null, null]), { target: TARGETS.inp, expected: 5 }).status, 'INSUFFICIENT');
  });
  it('fewer samples than expected is INSUFFICIENT', () => {
    assert.equal(verdict(aggregate([40, 48, 56]), { target: TARGETS.inp, expected: 5 }).status, 'INSUFFICIENT');
  });
  it('not applicable stays NOT_APPLICABLE whatever the samples', () => {
    assert.equal(verdict(aggregate([]), { target: TARGETS.inp, expected: 5, applicable: false }).status, 'NOT_APPLICABLE');
  });
});

describe('summariseRuns', () => {
  it('first-sample-missing INP: aggregated, flagged INSUFFICIENT, not skipped', () => {
    const s = summariseRuns([run(null), run(240), run(260), run(280), run(300)]);
    assert.equal(s.inp.applicable, true);
    assert.equal(s.inp.valid, 4);
    assert.equal(s.inp.missing, 1);
    assert.equal(s.inp.p75, 280);
    assert.equal(s.inp.verdict.status, 'INSUFFICIENT');
  });
  it('all INP missing on an interactive page: INSUFFICIENT, not PASS', () => {
    const s = summariseRuns([run(null), run(null), run(null), run(null), run(null)]);
    assert.equal(s.inp.verdict.status, 'INSUFFICIENT');
    assert.equal(s.inp.p75, null);
  });
  it('INP above target on every run: FAIL', () => {
    const s = summariseRuns([run(240), run(260), run(280), run(300), run(320)]);
    assert.equal(s.inp.verdict.status, 'FAIL');
    assert.equal(s.inp.p75, 300);
  });
  it('a page without a scripted interaction: INP NOT_APPLICABLE, LCP and CLS still judged', () => {
    const s = summariseRuns([1, 2, 3, 4, 5].map(() => run(null, { interactions: [] })));
    assert.equal(s.inp.applicable, false);
    assert.equal(s.inp.verdict.status, 'NOT_APPLICABLE');
    assert.equal(s.lcp.verdict.status, 'PASS');
    assert.equal(s.cls.verdict.status, 'PASS');
  });
  it('a missing LCP is INSUFFICIENT; an LCP above target is FAIL', () => {
    assert.equal(summariseRuns([run(40, { lcp: null }), run(40), run(40), run(40), run(40)]).lcp.verdict.status, 'INSUFFICIENT');
    assert.equal(summariseRuns([1, 2, 3, 4, 5].map(() => run(40, { lcp: 2900 }))).lcp.verdict.status, 'FAIL');
  });
  it('fewer runs than expected is INSUFFICIENT', () => {
    assert.equal(summariseRuns([run(40), run(40)], { expected: 5 }).inp.verdict.status, 'INSUFFICIENT');
  });
});
