#!/usr/bin/env node
/**
 * Recomputes the summaries of a recorded C5-17 or C5-18 case from its original raw runs, with the corrected
 * aggregation (c5/perfStats.js), and writes them next to what was recorded. The source record is only read.
 *
 *   node c5/perfRecompute.mjs <path/to/C5-17.json> <path/to/output.json>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { summariseRuns } from './perfStats.js';

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error('usage: node c5/perfRecompute.mjs <C5-17.json> <output.json>');
  process.exit(2);
}
const bytes = readFileSync(source);
const record = JSON.parse(bytes);
const expected = record.runsPerPage;
const pages = {};
const changes = [];
for (const [key, page] of Object.entries(record.pages)) {
  const recomputed = summariseRuns(page.runs, { expected });
  const was = page.summary;
  const brief = (m) => (m ? { valid: m.valid ?? null, missing: m.missing ?? null, median: m.median ?? null, p75: m.p75 ?? null, max: m.max ?? null } : null);
  pages[key] = {
    rawSamples: { lcp: page.runs.map((r) => r.lcp), cls: page.runs.map((r) => r.cls), inp: page.runs.map((r) => r.inp), scriptedInteractions: page.runs.map((r) => (r.interactions ?? []).length) },
    recorded: { lcp: brief(was.lcp), cls: brief(was.cls), inp: was.inp ? brief(was.inp) : null },
    recomputed: {
      lcp: { ...brief(recomputed.lcp), verdict: recomputed.lcp.verdict },
      cls: { ...brief(recomputed.cls), verdict: recomputed.cls.verdict },
      inp: { ...brief(recomputed.inp), applicable: recomputed.inp.applicable, verdict: recomputed.inp.verdict },
    },
  };
  for (const metric of ['lcp', 'cls', 'inp']) {
    const before = was[metric]?.p75 ?? null;
    const after = recomputed[metric].p75;
    if (before !== after) changes.push(`${key} ${metric} p75: recorded ${before}, recomputed ${after}`);
  }
}
writeFileSync(target, JSON.stringify({
  source,
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  caseId: record.caseId,
  recordedAt: record.recordedAt,
  runsPerPage: expected,
  recomputedAt: new Date().toISOString(),
  aggregation: 'c5/perfStats.js: every sample, order-independent; PASS only with every expected sample valid',
  p75Changes: changes,
  pages,
}, null, 2));
console.log(`${Object.keys(pages).length} page/profile summaries recomputed; p75 changes: ${changes.length ? changes.join('; ') : 'none'}`);
for (const [key, p] of Object.entries(pages)) {
  const v = p.recomputed;
  console.log(`${key.padEnd(20)} LCP ${v.lcp.verdict.status} (${v.lcp.p75})  CLS ${v.cls.verdict.status} (${v.cls.p75})  INP ${v.inp.verdict.status} (${v.inp.valid}/${expected} valid, p75 ${v.inp.p75})`);
}
