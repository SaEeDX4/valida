import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, inRange, loadPolicy } from './audit-gate.mjs';

/**
 * C6-T6 — controls for the dependency audit gate. The base inputs are the
 * real npm audit reports captured on 2026-11-18 (npm 11.21.1) and excerpts of
 * the real lock files; each control changes one thing.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const policy = loadPolicy();
const fixture = (pkg) => ({
  reportText: readFileSync(path.join(here, 'fixtures', `${pkg}-npm-audit-2026-11-18.json`), 'utf8'),
  lock: JSON.parse(readFileSync(path.join(here, 'fixtures', `${pkg}-lock-excerpt-2026-11-18.json`), 'utf8')),
});
const IN_FORCE = new Date('2026-11-25T00:00:00Z');
const PUBLISHED = { picomatch: ['2.3.1', '4.0.6', '4.0.7'] };
const run = (pkg, change = {}) => {
  const base = fixture(pkg);
  const report = JSON.parse(base.reportText);
  const lock = structuredClone(base.lock);
  change.report?.(report);
  change.lock?.(lock);
  return evaluate({ packageName: pkg, reportText: change.reportText ?? JSON.stringify(report), auditExit: change.auditExit ?? 1, lock, now: change.now ?? IN_FORCE, policy, registryVersions: 'registryVersions' in change ? change.registryVersions : PUBLISHED });
};
const reasons = (r) => r.failures.map((f) => f.reason);

for (const pkg of ['backend', 'frontend']) {
  test(`${pkg}: the exact approved finding → PASS WITH APPROVED EXCEPTION, named every run`, () => {
    const r = run(pkg);
    assert.equal(r.status, 'PASS WITH APPROVED EXCEPTION');
    assert.deepEqual(r.failures, []);
    assert.equal(r.exceptionsApplied.length, 1);
    assert.equal(r.exceptionsApplied[0].advisory, 'GHSA-fc5q-39xc-vjpf');
  });
}

test('the policy itself: one exception, exactly 30 days, fixed UTC times, the reviewed range', () => {
  const [e] = policy.exceptions;
  assert.equal(policy.exceptions.length, 1);
  assert.equal(policy.severityThreshold, 'high');
  assert.equal(e.startUtc, '2026-11-18T05:31:00Z');
  assert.equal(e.expiresUtc, '2026-12-18T05:31:00Z');
  assert.equal(Date.parse(e.expiresUtc) - Date.parse(e.startUtc), 30 * 86_400_000);
  assert.equal(e.advisoryRange, '<=4.0.7');
  assert.deepEqual(e.approvedVersions, ['4.0.7']);
});

test('an additional blocking advisory (high) fails, the exception still named', () => {
  const r = run('backend', {
    report: (rep) => {
      rep.vulnerabilities['qa-extra'] = { name: 'qa-extra', severity: 'high', isDirect: false, via: [{ source: 1, name: 'qa-extra', dependency: 'qa-extra', title: 'QA', url: 'https://github.com/advisories/GHSA-qqqq-qqqq-qqqq', severity: 'high', cwe: [], cvss: {}, range: '<1.0.1' }], effects: [], range: '<1.0.1', nodes: ['node_modules/qa-extra'], fixAvailable: true };
      rep.metadata.vulnerabilities.total += 1;
    },
  });
  assert.equal(r.status, 'FAIL');
  assert.deepEqual(reasons(r), ['BLOCKING_ADVISORY']);
});

test('a critical advisory on the excepted package itself fails (only the reviewed advisory is excepted)', () => {
  const r = run('frontend', {
    report: (rep) => rep.vulnerabilities.picomatch.via.push({ source: 2, name: 'picomatch', dependency: 'picomatch', title: 'QA', url: 'https://github.com/advisories/GHSA-wwww-wwww-wwww', severity: 'critical', cwe: [], cvss: {}, range: '<=4.0.7' }),
  });
  assert.equal(r.status, 'FAIL');
  assert.ok(reasons(r).includes('BLOCKING_ADVISORY'));
});

test('below the threshold (moderate) is listed and does not fail: the existing --audit-level=high policy', () => {
  const r = run('backend', {
    report: (rep) => {
      rep.vulnerabilities['qa-moderate'] = { name: 'qa-moderate', severity: 'moderate', isDirect: false, via: [{ source: 3, name: 'qa-moderate', dependency: 'qa-moderate', title: 'QA', url: 'https://github.com/advisories/GHSA-mmmm-mmmm-mmmm', severity: 'moderate', cwe: [], cvss: {}, range: '<2.0.0' }], effects: [], range: '<2.0.0', nodes: ['node_modules/qa-moderate'], fixAvailable: true };
      rep.metadata.vulnerabilities.total += 1;
    },
  });
  assert.equal(r.status, 'PASS WITH APPROVED EXCEPTION');
  assert.deepEqual(r.belowThreshold.map((i) => i.advisory), ['GHSA-mmmm-mmmm-mmmm']);
});

test('production exposure: the excepted package reachable from a production dependency fails', () => {
  const r = run('backend', { lock: (lock) => delete lock.packages['node_modules/picomatch'].dev });
  assert.equal(r.status, 'FAIL');
  assert.ok(reasons(r).includes('PRODUCTION_EXPOSURE'));
});

test('production exposure through a dependent package (vite in production) fails', () => {
  const r = run('frontend', { lock: (lock) => delete lock.packages['node_modules/vite'].dev });
  assert.ok(reasons(r).includes('PRODUCTION_EXPOSURE'));
});

test('dependency-path expansion: a new package reaching picomatch fails', () => {
  const r = run('backend', {
    report: (rep) => {
      rep.vulnerabilities.micromatch = { name: 'micromatch', severity: 'high', isDirect: false, via: ['picomatch'], effects: [], range: '*', nodes: ['node_modules/micromatch'], fixAvailable: true };
      rep.metadata.vulnerabilities.total += 1;
    },
    lock: (lock) => (lock.packages['node_modules/micromatch'] = { version: '4.0.8', dev: true }),
  });
  assert.deepEqual(reasons(r), ['PATH_EXPANSION']);
  // Not in the lock at all: also treated as production (conservative).
  const unknown = run('backend', {
    report: (rep) => {
      rep.vulnerabilities.micromatch = { name: 'micromatch', severity: 'high', isDirect: false, via: ['picomatch'], effects: [], range: '*', nodes: ['node_modules/micromatch'], fixAvailable: true };
      rep.metadata.vulnerabilities.total += 1;
    },
  });
  assert.deepEqual(reasons(unknown), ['PATH_EXPANSION', 'PRODUCTION_EXPOSURE']);
});

test('dependency-path expansion: a second copy of picomatch at a new node path fails', () => {
  const r = run('frontend', { report: (rep) => rep.vulnerabilities.picomatch.nodes.push('node_modules/qa-tool/node_modules/picomatch') });
  assert.ok(reasons(r).includes('PATH_EXPANSION'));
});

test('an unreviewed version (picomatch 4.0.6, or vite moved) fails', () => {
  assert.deepEqual(reasons(run('backend', { lock: (lock) => (lock.packages['node_modules/picomatch'].version = '4.0.6') })), ['UNREVIEWED_VERSION']);
  assert.deepEqual(reasons(run('frontend', { lock: (lock) => (lock.packages['node_modules/vite'].version = '8.2.6') })), ['UNREVIEWED_VERSION']);
});

test('the advisory range changed from the reviewed one fails', () => {
  const r = run('backend', { report: (rep) => (rep.vulnerabilities.picomatch.via[0].range = '<=4.0.9') });
  assert.equal(r.status, 'FAIL');
  assert.match(JSON.stringify(r.failures), /advisory range is now <=4.0.9/);
});

test('a patched release appears → FAIL: remediate instead of keeping the exception', () => {
  const r = run('backend', { registryVersions: { picomatch: [...PUBLISHED.picomatch, '4.0.8'] } });
  assert.equal(r.status, 'FAIL');
  assert.match(JSON.stringify(r.failures), /REMEDIATION AVAILABLE: picomatch 4\.0\.8/);
  // A prerelease is not a release.
  assert.equal(run('backend', { registryVersions: { picomatch: [...PUBLISHED.picomatch, '4.0.8-beta.1'] } }).status, 'PASS WITH APPROVED EXCEPTION');
});

test('the registry cannot be read → FAIL (no silent pass on a network error)', () => {
  const r = run('frontend', { registryVersions: null });
  assert.equal(r.status, 'FAIL');
  assert.match(JSON.stringify(r.failures), /could not read the published versions/);
});

test('expiry boundaries: valid from the start, until 1 ms before the expiry; never before, never at or after', () => {
  const at = (iso) => run('backend', { now: new Date(iso) }).status;
  assert.equal(at('2026-11-18T05:30:59.999Z'), 'FAIL');
  assert.equal(at('2026-11-18T05:31:00.000Z'), 'PASS WITH APPROVED EXCEPTION');
  assert.equal(at('2026-12-18T05:30:59.999Z'), 'PASS WITH APPROVED EXCEPTION');
  assert.equal(at('2026-12-18T05:31:00.000Z'), 'FAIL');
  assert.match(JSON.stringify(run('backend', { now: new Date('2026-12-18T05:31:00Z') }).failures), /EXPIRED/);
});

test('audit failure: an npm error object, or an exit code other than 0/1, fails', () => {
  assert.deepEqual(reasons(run('backend', { reportText: JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'request to registry failed' } }) })), ['AUDIT_ERROR']);
  assert.deepEqual(reasons(run('backend', { auditExit: 2 })), ['AUDIT_ERROR']);
  assert.deepEqual(reasons(run('backend', { auditExit: -1 })), ['AUDIT_ERROR']);
});

test('malformed or unsupported input fails', () => {
  assert.deepEqual(reasons(run('backend', { reportText: '{"auditReportVersion": 2, "vulner' })), ['MALFORMED_REPORT']);
  assert.deepEqual(reasons(run('backend', { report: (rep) => (rep.auditReportVersion = 1) })), ['UNSUPPORTED_REPORT']);
  assert.deepEqual(reasons(run('backend', { report: (rep) => (rep.metadata.vulnerabilities.total = 2) })), ['MALFORMED_REPORT']);
  assert.deepEqual(reasons(run('backend', { report: (rep) => (rep.vulnerabilities.vite.via = 'picomatch') })), ['MALFORMED_REPORT']);
  assert.ok(reasons(run('backend', { report: (rep) => rep.vulnerabilities.vite.via.push('qa-not-in-report') })).every((x) => x === 'MALFORMED_REPORT'));
  assert.deepEqual(reasons(run('backend', { auditExit: 0 })), ['MALFORMED_REPORT']); // exit 0 with findings
  assert.deepEqual(reasons(run('backend', { lock: (lock) => (lock.lockfileVersion = 2) })), ['UNSUPPORTED_LOCKFILE']);
});

test('a clean report → PASS, and no exception is claimed', () => {
  const clean = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }, dependencies: {} } });
  const r = run('backend', { reportText: clean, auditExit: 0 });
  assert.equal(r.status, 'PASS');
  assert.deepEqual(r.exceptionsApplied, []);
  assert.equal(run('frontend', { reportText: clean, auditExit: 1 }).status, 'FAIL'); // exit 1 with no findings: inconsistent
});

// Correction (Astra, 2026-11-18): every entry must be explained by the
// advisories it reaches, at its own severity. An entry with no advisory root,
// or whose roots do not account for its severity, fails closed.
const qaEntry = (name, severity, via) => ({ name, severity, isDirect: false, via, effects: [], range: '*', nodes: [`node_modules/${name}`], fixAvailable: false });
const addEntries = (...list) => (rep) => {
  for (const e of list) rep.vulnerabilities[e.name] = e;
  rep.metadata.vulnerabilities.total += list.length;
};
const qaAdvisory = (name, severity, id) => ({ source: 9, name, dependency: name, title: 'QA', url: `https://github.com/advisories/${id}`, severity, cwe: [], cvss: {}, range: '<1.0.0' });

test('an entry with an empty via (no advisory at all) fails closed — the reproduced fail-open', () => {
  // Astra's control, exactly: the only entry, high, via [], total 1, npm exit 1.
  const only = JSON.stringify({ auditReportVersion: 2, vulnerabilities: { unexpected: { name: 'unexpected', severity: 'high', via: [], nodes: ['node_modules/unexpected'] } }, metadata: { vulnerabilities: { total: 1 } } });
  for (const pkg of ['backend', 'frontend']) {
    const r = run(pkg, { reportText: only, auditExit: 1 });
    assert.equal(r.status, 'FAIL');
    assert.deepEqual(reasons(r), ['MALFORMED_REPORT']);
    assert.deepEqual(r.exceptionsApplied, []);
  }
  // Critical, and beside the approved finding: the exception does not cover it.
  const r = run('backend', { report: addEntries(qaEntry('unexpected', 'critical', [])) });
  assert.equal(r.status, 'FAIL');
  assert.deepEqual(reasons(r), ['MALFORMED_REPORT']);
});

test('a cyclic via chain with no advisory root fails closed; a real cycle that reaches the advisory still passes', () => {
  const r = run('backend', { report: addEntries(qaEntry('qa-a', 'high', ['qa-b']), qaEntry('qa-b', 'high', ['qa-a'])) });
  assert.equal(r.status, 'FAIL');
  assert.deepEqual(reasons(r), ['MALFORMED_REPORT', 'MALFORMED_REPORT']);
  const self = run('frontend', { report: addEntries(qaEntry('qa-self', 'critical', ['qa-self'])) });
  assert.deepEqual(reasons(self), ['MALFORMED_REPORT']);
  // The backend report really contains vitest ⇄ @vitest/coverage-v8; both reach picomatch's advisory.
  const real = JSON.parse(fixture('backend').reportText).vulnerabilities;
  assert.ok(real.vitest.via.includes('@vitest/coverage-v8') && real['@vitest/coverage-v8'].via.includes('vitest'));
  assert.equal(run('backend').status, 'PASS WITH APPROVED EXCEPTION');
});

test('a high/critical entry whose reachable roots do not explain its severity fails closed', () => {
  // High, but its only advisory is moderate.
  const direct = run('backend', { report: addEntries(qaEntry('qa-up', 'high', [qaAdvisory('qa-up', 'moderate', 'GHSA-mmmm-mmmm-mmmm')])) });
  assert.equal(direct.status, 'FAIL');
  assert.deepEqual(reasons(direct), ['MALFORMED_REPORT']);
  // High, through an entry whose only advisory is moderate (consistent itself).
  const chain = run('frontend', { report: addEntries(qaEntry('qa-top', 'high', ['qa-mid']), qaEntry('qa-mid', 'moderate', [qaAdvisory('qa-mid', 'moderate', 'GHSA-mmmm-mmmm-mmmm')])) });
  assert.equal(chain.status, 'FAIL');
  assert.deepEqual(reasons(chain), ['MALFORMED_REPORT']);
  // An in-scope path whose severity was raised beyond the approved advisory.
  const raised = run('backend', { report: (rep) => (rep.vulnerabilities.vite.severity = 'critical') });
  assert.equal(raised.status, 'FAIL');
  assert.deepEqual(reasons(raised), ['MALFORMED_REPORT']);
  // An entry labelled below the threshold that in fact reaches the high advisory.
  const lowered = run('frontend', { report: (rep) => (rep.vulnerabilities.tinyglobby.severity = 'moderate') });
  assert.equal(lowered.status, 'FAIL');
  assert.deepEqual(reasons(lowered), ['MALFORMED_REPORT']);
});

test('the policy refuses a period that is not exactly 30 days, or a range form it cannot evaluate', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'valida-audit-policy-'));
  const bad = (change) => {
    const p = structuredClone(JSON.parse(readFileSync(path.join(here, 'audit-policy.json'), 'utf8')));
    change(p.exceptions[0]);
    const file = path.join(dir, 'p.json');
    writeFileSync(file, JSON.stringify(p));
    return () => loadPolicy(file);
  };
  assert.throws(bad((e) => (e.expiresUtc = '2026-12-19T05:31:00Z')), /exactly 30 days/);
  assert.throws(bad((e) => (e.advisoryRange = '>=4.0.0 <4.0.8')), /advisoryRange/);
  assert.throws(bad((e) => (e.approvedVersions = ['4.0.8'])), /approvedVersions/);
  assert.equal(inRange('4.0.7', '<=4.0.7'), true);
  assert.equal(inRange('4.0.8', '<=4.0.7'), false);
});

test('the CLI keeps the raw report and npm exit code, and prints the status (not "no vulnerabilities")', () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'valida-audit-gate-'));
  const versions = path.join(out, 'versions.json');
  writeFileSync(versions, JSON.stringify(PUBLISHED));
  const r = spawnSync(process.execPath, [path.join(here, 'audit-gate.mjs'), '--package', 'backend', '--out', out, '--report', path.join(here, 'fixtures', 'backend-npm-audit-2026-11-18.json'), '--audit-exit', '1', '--lock', path.join(here, 'fixtures', 'backend-lock-excerpt-2026-11-18.json'), '--now', IN_FORCE.toISOString(), '--registry-versions', versions], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^AUDIT GATE backend: PASS WITH APPROVED EXCEPTION \(npm audit exit 1; threshold high\)/);
  assert.doesNotMatch(r.stdout, /no vulnerabilities/i);
  assert.equal(readFileSync(path.join(out, 'backend-npm-audit.exit.txt'), 'utf8').trim(), '1');
  assert.equal(readFileSync(path.join(out, 'backend-npm-audit.raw.json'), 'utf8'), readFileSync(path.join(here, 'fixtures', 'backend-npm-audit-2026-11-18.json'), 'utf8'));
  const expired = spawnSync(process.execPath, [path.join(here, 'audit-gate.mjs'), '--package', 'backend', '--out', out, '--report', path.join(here, 'fixtures', 'backend-npm-audit-2026-11-18.json'), '--audit-exit', '1', '--lock', path.join(here, 'fixtures', 'backend-lock-excerpt-2026-11-18.json'), '--now', '2026-12-18T05:31:00Z', '--registry-versions', versions], { encoding: 'utf8' });
  assert.equal(expired.status, 1);
  assert.match(expired.stdout, /FAIL EXCEPTION_NOT_APPLICABLE.*EXPIRED/);
});
