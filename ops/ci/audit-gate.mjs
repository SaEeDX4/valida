#!/usr/bin/env node
/**
 * C6-T6 — the dependency audit gate (Doc 13 §§133–137, §310; C6 plan r3 §6).
 *
 *   node ops/ci/audit-gate.mjs --package backend|frontend --out <folder>
 *
 * It runs `npm audit --json` in the package (ALL dependencies, development
 * included — never `--omit=dev`), keeps the complete raw report and npm's own
 * exit code, and decides against ops/ci/audit-policy.json:
 *
 *   PASS                          no finding at or above the threshold
 *   PASS WITH APPROVED EXCEPTION  the only such findings are an approved,
 *                                 in-date exception, exactly in its reviewed
 *                                 scope — and it says so, by advisory, every run
 *   FAIL                          anything else, including:
 *     - any other finding at or above the threshold (the existing policy)
 *     - the excepted advisory in a version, path or dependent package
 *       outside the reviewed scope (dependency-path expansion)
 *     - the excepted advisory reaching a production (non-dev) dependency
 *     - the advisory's range changed from the reviewed one
 *     - a patched release of the package now exists (remediate instead)
 *     - before the start or at/after the expiry (never extended automatically)
 *     - npm audit errors, network errors, an unexpected exit code, or a
 *       malformed or unsupported report or lock file
 *     - any entry the report does not explain: no advisory reachable through
 *       its `via` (empty, or a cycle with no advisory root), or a severity
 *       that its reachable advisories do not account for
 *
 * Findings below the threshold are listed and do not fail the gate (the
 * existing `--audit-level=high` policy). Exit: 0 PASS or PASS WITH APPROVED
 * EXCEPTION; 1 FAIL; 2 the gate could not be configured.
 *
 * For tests, `--report <file> --audit-exit <n> --lock <file> --now <ISO>
 * --registry-versions <file|ERROR>` replace the live inputs.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const rank = (s) => SEVERITIES.indexOf(s);

/** x.y.z only; anything else (a prerelease, a tag) is not a release. */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v));
  return m ? m.slice(1, 4).map(Number) : null;
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
/** The two range forms the policy may use: "<=X.Y.Z" and "<X.Y.Z". */
export function inRange(version, range) {
  const m = /^(<=|<)(\d+\.\d+\.\d+)$/.exec(range);
  const v = parseVersion(version);
  if (!m || !v) return null;
  const c = cmp(v, parseVersion(m[2]));
  return m[1] === '<=' ? c <= 0 : c < 0;
}

export function loadPolicy(file = path.join(here, 'audit-policy.json')) {
  const policy = JSON.parse(readFileSync(file, 'utf8'));
  const problems = [];
  if (policy.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (!['low', 'moderate', 'high', 'critical'].includes(policy.severityThreshold)) problems.push('severityThreshold');
  for (const e of policy.exceptions ?? []) {
    if (!/^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/.test(e.advisory ?? '')) problems.push('exception advisory id');
    if (!/^(<=|<)\d+\.\d+\.\d+$/.test(e.advisoryRange ?? '')) problems.push(`${e.advisory}: advisoryRange must be <=X.Y.Z or <X.Y.Z`);
    const start = Date.parse(e.startUtc);
    const end = Date.parse(e.expiresUtc);
    if (!/Z$/.test(e.startUtc ?? '') || !/Z$/.test(e.expiresUtc ?? '') || Number.isNaN(start) || Number.isNaN(end)) problems.push(`${e.advisory}: startUtc/expiresUtc must be UTC times`);
    else if (end - start !== 30 * 24 * 60 * 60 * 1000) problems.push(`${e.advisory}: the approved period is exactly 30 days`);
    if (!Array.isArray(e.approvedVersions) || e.approvedVersions.some((v) => !parseVersion(v) || inRange(v, e.advisoryRange) !== true)) problems.push(`${e.advisory}: approvedVersions`);
    if (!e.scope || typeof e.scope !== 'object') problems.push(`${e.advisory}: scope`);
    if (typeof e.decision !== 'string' || !e.decision) problems.push(`${e.advisory}: decision record`);
  }
  if (problems.length) throw new Error(`audit policy invalid: ${problems.join('; ')}`);
  return policy;
}

/**
 * The decision, from inputs only (no I/O): the raw report text, npm's exit
 * code, the lock file, the time, and the registry's published versions of
 * each excepted package (or null when they could not be read).
 */
export function evaluate({ packageName, reportText, auditExit, lock, now, policy, registryVersions }) {
  const fail = [];
  const info = [];
  const used = [];
  const done = (status) => ({ package: packageName, status, failures: fail, belowThreshold: info, exceptionsApplied: used, threshold: policy.severityThreshold, evaluatedAt: now.toISOString() });

  if (auditExit !== 0 && auditExit !== 1) {
    fail.push({ reason: 'AUDIT_ERROR', detail: `npm audit exited ${auditExit}` });
    return done('FAIL');
  }
  let report;
  try {
    report = JSON.parse(reportText);
  } catch {
    fail.push({ reason: 'MALFORMED_REPORT', detail: 'not JSON' });
    return done('FAIL');
  }
  if (report && typeof report === 'object' && 'error' in report) {
    fail.push({ reason: 'AUDIT_ERROR', detail: `npm reported an error (${report.error?.code ?? 'unknown'})` });
    return done('FAIL');
  }
  if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null || typeof report.metadata?.vulnerabilities !== 'object') {
    fail.push({ reason: 'UNSUPPORTED_REPORT', detail: `auditReportVersion ${report?.auditReportVersion}` });
    return done('FAIL');
  }
  const entries = Object.entries(report.vulnerabilities);
  const total = report.metadata.vulnerabilities.total;
  for (const [name, v] of entries) {
    if (v?.name !== name || rank(v.severity) < 0 || !Array.isArray(v.via) || !Array.isArray(v.nodes) || v.nodes.some((n) => typeof n !== 'string')) {
      fail.push({ reason: 'MALFORMED_REPORT', detail: `entry ${name}` });
      return done('FAIL');
    }
  }
  if (total !== entries.length || (auditExit === 0) !== (entries.length === 0)) {
    fail.push({ reason: 'MALFORMED_REPORT', detail: `metadata total ${total}, entries ${entries.length}, npm exit ${auditExit}` });
    return done('FAIL');
  }
  if (lock?.lockfileVersion !== 3 || typeof lock.packages !== 'object') {
    fail.push({ reason: 'UNSUPPORTED_LOCKFILE', detail: `lockfileVersion ${lock?.lockfileVersion}` });
    return done('FAIL');
  }

  const vulns = new Map(entries);
  const threshold = rank(policy.severityThreshold);
  // Every advisory reachable from an entry, following npm's `via` names.
  const roots = (name, seen = new Set()) => {
    if (seen.has(name)) return [];
    seen.add(name);
    const v = vulns.get(name);
    if (!v) return [{ unknown: name }];
    return v.via.flatMap((x) => (typeof x === 'string' ? roots(x, seen) : [{ advisory: x, at: name }]));
  };
  const exceptionFor = (url) => policy.exceptions?.find((e) => typeof url === 'string' && url.endsWith(`/${e.advisory}`));

  // 1. Direct advisories.
  const coveredEntries = new Set();
  for (const [name, v] of entries) {
    for (const adv of v.via.filter((x) => typeof x !== 'string')) {
      const severity = adv.severity;
      const id = typeof adv.url === 'string' ? adv.url.split('/').pop() : String(adv.source);
      if (rank(severity) < 0) {
        fail.push({ reason: 'MALFORMED_REPORT', detail: `advisory ${id} severity` });
        continue;
      }
      if (rank(severity) < threshold) {
        info.push({ advisory: id, package: name, severity, range: adv.range });
        continue;
      }
      const e = exceptionFor(adv.url);
      if (!e) {
        fail.push({ reason: 'BLOCKING_ADVISORY', advisory: id, package: name, severity, range: adv.range });
        continue;
      }
      const problems = [];
      const scope = e.scope?.[packageName];
      const t = now.getTime();
      if (!scope) problems.push(`no reviewed scope for ${packageName}`);
      if (t < Date.parse(e.startUtc)) problems.push(`not yet in force (starts ${e.startUtc})`);
      if (t >= Date.parse(e.expiresUtc)) problems.push(`EXPIRED at ${e.expiresUtc}: remediate or obtain a new owner decision`);
      if (name !== e.package || adv.name !== e.package) problems.push(`advisory found on ${name}, reviewed for ${e.package}`);
      if (adv.range !== e.advisoryRange) problems.push(`advisory range is now ${adv.range}, reviewed ${e.advisoryRange}`);
      const versions = registryVersions?.[e.package];
      if (!Array.isArray(versions)) problems.push(`could not read the published versions of ${e.package}`);
      else {
        const fixed = versions.filter((x) => parseVersion(x) && inRange(x, e.advisoryRange) === false);
        if (fixed.length) problems.push(`REMEDIATION AVAILABLE: ${e.package} ${fixed.join(', ')} is outside ${e.advisoryRange} — upgrade instead`);
      }
      if (problems.length) fail.push({ reason: 'EXCEPTION_NOT_APPLICABLE', advisory: id, package: name, problems });
      else {
        used.push({ advisory: e.advisory, package: name, range: adv.range, startUtc: e.startUtc, expiresUtc: e.expiresUtc, decision: e.decision });
        coveredEntries.add(name);
      }
    }
  }

  // 2. Every entry must be explained by the advisories it reaches (npm sets an
  //    entry's severity to the highest of them). Fail closed when an entry
  //    reaches no advisory (an empty `via`, or a cycle with no advisory root),
  //    refers to an entry not in the report, or carries a severity its roots
  //    do not account for. Then each entry at or above the threshold is either
  //    a blocking advisory (failed in step 1) or inside an approved
  //    exception's reviewed scope — exact name, node paths and version,
  //    development only.
  for (const [name, v] of entries) {
    const reachable = roots(name);
    const unknown = reachable.filter((r) => r.unknown);
    if (unknown.length) {
      fail.push({ reason: 'MALFORMED_REPORT', detail: `${name} refers to ${unknown.map((u) => u.unknown).join(', ')}` });
      continue;
    }
    if (reachable.length === 0) {
      fail.push({ reason: 'MALFORMED_REPORT', package: name, detail: `${name} (${v.severity}) reaches no advisory: unexplained finding` });
      continue;
    }
    const explained = Math.max(...reachable.map((r) => rank(r.advisory.severity)));
    if (explained !== rank(v.severity)) {
      fail.push({ reason: 'MALFORMED_REPORT', package: name, detail: `${name} is ${v.severity}, but the advisories it reaches are at most ${SEVERITIES[explained] ?? 'invalid'}: unexplained severity` });
      continue;
    }
    if (rank(v.severity) < threshold) continue;
    const highRoots = reachable.filter((r) => rank(r.advisory.severity) >= threshold);
    const viaException = highRoots.filter((r) => exceptionFor(r.advisory.url));
    // A blocking root is itself a direct advisory of some entry, and step 1
    // has failed it; nothing here can turn that into a pass.
    if (viaException.length === 0) continue;
    for (const r of viaException) {
      const e = exceptionFor(r.advisory.url);
      const reviewed = e.scope?.[packageName]?.[name];
      const lockVersions = v.nodes.map((n) => lock.packages[n]?.version ?? null);
      const prod = v.nodes.filter((n) => lock.packages[n]?.dev !== true);
      if (!reviewed) fail.push({ reason: 'PATH_EXPANSION', advisory: e.advisory, package: name, detail: `${name} is not in the reviewed scope` });
      else if (JSON.stringify([...v.nodes].sort()) !== JSON.stringify([...reviewed.nodes].sort())) fail.push({ reason: 'PATH_EXPANSION', advisory: e.advisory, package: name, detail: `nodes ${v.nodes.join(', ')}; reviewed ${reviewed.nodes.join(', ')}` });
      else if (lockVersions.some((x) => x !== reviewed.version)) fail.push({ reason: 'UNREVIEWED_VERSION', advisory: e.advisory, package: name, detail: `installed ${lockVersions.join(', ')}; reviewed ${reviewed.version}` });
      if (prod.length) fail.push({ reason: 'PRODUCTION_EXPOSURE', advisory: e.advisory, package: name, detail: `${prod.join(', ')} is a production dependency` });
    }
  }
  // Each reviewed package of an applied exception must still be a development dependency.
  for (const u of used) {
    const e = policy.exceptions.find((x) => x.advisory === u.advisory);
    for (const [name, reviewed] of Object.entries(e.scope[packageName] ?? {})) {
      for (const n of reviewed.nodes) if (lock.packages[n] && lock.packages[n].dev !== true) fail.push({ reason: 'PRODUCTION_EXPOSURE', advisory: e.advisory, package: name, detail: `${n} is a production dependency` });
    }
  }

  if (fail.length) return done('FAIL');
  if (used.length) return done('PASS WITH APPROVED EXCEPTION');
  return done('PASS');
}

function registryVersionsFor(policy, cwd, override) {
  if (override === 'ERROR') return null;
  if (override) return JSON.parse(readFileSync(override, 'utf8'));
  const out = {};
  for (const e of policy.exceptions ?? []) {
    const r = spawnSync('npm', ['view', e.package, 'versions', '--json'], { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0) return null;
    try {
      const list = JSON.parse(r.stdout);
      out[e.package] = Array.isArray(list) ? list : [list];
    } catch {
      return null;
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { package: { type: 'string' }, out: { type: 'string' }, report: { type: 'string' }, 'audit-exit': { type: 'string' }, lock: { type: 'string' }, now: { type: 'string' }, 'registry-versions': { type: 'string' }, policy: { type: 'string' } } });
  if (!['backend', 'frontend'].includes(values.package) || !values.out) {
    process.stderr.write('usage: audit-gate.mjs --package backend|frontend --out <folder>\n');
    return 2;
  }
  let policy;
  try {
    policy = loadPolicy(values.policy);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  const cwd = path.join(REPO, values.package);
  let reportText;
  let auditExit;
  if (values.report) {
    reportText = readFileSync(values.report, 'utf8');
    auditExit = Number(values['audit-exit']);
  } else {
    const r = spawnSync('npm', ['audit', '--json'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
    reportText = r.stdout ?? '';
    auditExit = r.status ?? -1;
    mkdirSync(values.out, { recursive: true });
    if (r.stderr) writeFileSync(path.join(values.out, `${values.package}-npm-audit.stderr.txt`), r.stderr);
  }
  mkdirSync(values.out, { recursive: true });
  writeFileSync(path.join(values.out, `${values.package}-npm-audit.raw.json`), reportText);
  writeFileSync(path.join(values.out, `${values.package}-npm-audit.exit.txt`), `${auditExit}\n`);
  let lock = null;
  try {
    lock = JSON.parse(readFileSync(values.lock ?? path.join(cwd, 'package-lock.json'), 'utf8'));
  } catch {
    lock = null;
  }
  const now = values.now ? new Date(values.now) : new Date();
  const registryVersions = registryVersionsFor(policy, cwd, values['registry-versions']);
  const result = evaluate({ packageName: values.package, reportText, auditExit, lock, now, policy, registryVersions });
  writeFileSync(path.join(values.out, `${values.package}-audit-gate.json`), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [`AUDIT GATE ${values.package}: ${result.status} (npm audit exit ${auditExit}; threshold ${result.threshold})`];
  for (const u of result.exceptionsApplied) lines.push(`  APPROVED EXCEPTION ${u.advisory} (${u.package} ${u.range}), in force ${u.startUtc} to ${u.expiresUtc}; decision ${u.decision}`);
  for (const f of result.failures) lines.push(`  FAIL ${f.reason}: ${f.advisory ?? ''} ${f.package ?? ''} ${f.detail ?? ''}${f.problems ? ` — ${f.problems.join('; ')}` : ''}`.replace(/ +/g, ' '));
  for (const i of result.belowThreshold) lines.push(`  below threshold: ${i.advisory} ${i.package} (${i.severity})`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return result.status === 'FAIL' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
