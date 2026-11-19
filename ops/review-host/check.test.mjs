import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPPING, parseCheckerArgs } from './check.mjs';

/** C6-T6 — the checker's refusals and its R0/R1–R14 mapping (no network). */
const SHA = '0123456789abcdef0123456789abcdef01234567';
const base = ['--site', 'https://review-site.example.test', '--api', 'https://review-api.example.test', '--mode', 'review', '--perspective', 'listed'];
const problems = (argv) => parseCheckerArgs(argv).problems;

test('a complete HTTPS invocation is accepted', () => {
  assert.deepEqual(problems([...base, '--sha', SHA]), []);
});

test('a missing release SHA is refused: every run checks R14', () => {
  assert.ok(problems(base).some((p) => p.startsWith('--sha is required')));
});

test('a malformed SHA is refused (short, uppercase, a tag)', () => {
  for (const sha of [SHA.slice(0, 7), SHA.toUpperCase(), 'v1.0.0']) assert.ok(problems([...base, '--sha', sha]).some((p) => p.startsWith('--sha must be')));
});

test('plain http is refused, even for loopback, unless --allow-loopback-http; never for another host', () => {
  const http = ['--site', 'http://127.0.0.1:4400', '--api', 'http://127.0.0.1:4401', '--mode', 'review', '--perspective', 'listed', '--sha', SHA];
  assert.ok(problems(http).some((p) => p.includes('https')));
  assert.deepEqual(problems([...http, '--allow-loopback-http']), []);
  const remote = ['--site', 'http://review.example.test', '--api', 'http://api.example.test', '--mode', 'review', '--perspective', 'listed', '--sha', SHA, '--allow-loopback-http'];
  assert.ok(problems(remote).some((p) => p.includes('https')));
});

test('a URL that is not an origin is refused', () => {
  assert.ok(problems(['--site', 'https://x.example.test/careers', '--api', 'https://user:pw@y.example.test', '--mode', 'review', '--perspective', 'listed', '--sha', SHA]).length >= 2);
});

test('every row R0.1–R0.10 and R1–R14 is mapped to automated checks or a named operator step, with where it runs', () => {
  const ids = MAPPING.map((m) => m.id);
  for (let i = 1; i <= 10; i += 1) assert.ok(ids.includes(`R0.${i}`), `R0.${i}`);
  for (let i = 1; i <= 14; i += 1) assert.ok(ids.includes(`R${i}`), `R${i}`);
  for (const m of MAPPING) {
    assert.ok(m.automated.length > 0 || (typeof m.operator === 'string' && m.operator.length > 0), m.id);
    assert.ok(m.where.length > 0, m.id);
  }
});
