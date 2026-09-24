#!/usr/bin/env node
/**
 * Frontend quality budget gate (Doc 16 PERF-009 … PERF-013).
 *
 * Runs against the REAL production build in dist/, so it measures what is
 * actually shipped rather than what the source implies. Exits non-zero on any
 * breach, so it can gate CI and Windows QA.
 *
 *   npm run build && npm run verify:budgets
 *
 * MEASUREMENT HONESTY
 * Build output and network transfer are different things and are reported
 * separately. Legacy .woff fallbacks are emitted by the font packages but are
 * never requested by a woff2-capable browser (universal since 2016), so they
 * are counted as build output and explicitly NOT as initial transfer.
 * .woff2 and .png are already compressed; gzipping them again would
 * understate real transfer, so their own byte size is used.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * fileURLToPath, never URL#pathname.
 *
 * `.pathname` returns the URL-encoded path component, not a filesystem path.
 * On Windows — where authoritative QA runs — it yields "/C:/Users/..." with a
 * leading slash before the drive letter, so existsSync() fails and this gate
 * would report "dist/ not found" after a successful build. On every OS it also
 * leaves spaces encoded as %20, breaking any checkout path that contains one.
 */
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const KIB = 1024;

/** Doc 16 budgets, in KiB of the units each requirement specifies. */
const BUDGETS = {
  'PERF-009': { label: 'initial public JS (compressed)', limit: 220 },
  'PERF-010': { label: 'JS review threshold (compressed)', limit: 300 },
  'PERF-011': { label: 'Phase-1 CSS (compressed)', limit: 70 },
  'PERF-012': { label: 'initial critical web fonts', limit: 200 },
  'PERF-013': { label: 'Home first-load transfer', limit: 1.2 * 1024 },
};

/** Fixture markers that must never appear in a production build. */
const FIXTURE_MARKERS = [
  'DEV FIXTURE',
  'installDevFixtures',
  'devJobFixtures',
  'DEVELOPMENT FIXTURES ACTIVE',
  'dev-fixture',
  'cybersecurity-specialist',
];

if (!existsSync(DIST)) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(2);
}

const assetsDir = join(DIST, 'assets');
const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
const sizeOf = (f) => statSync(join(assetsDir, f)).size;
const gzipOf = (f) => gzipSync(readFileSync(join(assetsDir, f))).length;
const kib = (bytes) => bytes / KIB;
const fmt = (n) => `${n.toFixed(1)} KiB`;

const byExt = (ext) => assets.filter((f) => extname(f) === ext);

const js = byExt('.js');
const css = byExt('.css');
const woff2 = byExt('.woff2');
const woff = byExt('.woff');

const jsGzip = js.reduce((sum, f) => sum + gzipOf(f), 0);
const cssGzip = css.reduce((sum, f) => sum + gzipOf(f), 0);
// Already-compressed formats: their own size IS the transfer size.
const woff2Bytes = woff2.reduce((sum, f) => sum + sizeOf(f), 0);
const woffBytes = woff.reduce((sum, f) => sum + sizeOf(f), 0);

const html = join(DIST, 'index.html');
const htmlGzip = existsSync(html) ? gzipSync(readFileSync(html)).length : 0;

/**
 * Assets the Home document requests before first paint: the HTML, the CSS and
 * JS bundles, the fonts, the eagerly-loaded header logo and the favicons.
 * Below-the-fold, lazily-loaded images are excluded because they are not part
 * of first-load transfer.
 */
const brandDir = join(DIST, 'brand');
const brandSize = (name) => (existsSync(join(brandDir, name)) ? statSync(join(brandDir, name)).size : 0);
const eagerBrand =
  brandSize('valida-logo-horizontal-transparent.png') +
  brandSize('favicon.ico') +
  brandSize('valida-app-icon-32.png') +
  brandSize('valida-app-icon-16.png');

const homeFirstLoad = htmlGzip + cssGzip + jsGzip + woff2Bytes + eagerBrand;

const results = [
  ['PERF-009', kib(jsGzip)],
  ['PERF-010', kib(jsGzip)],
  ['PERF-011', kib(cssGzip)],
  ['PERF-012', kib(woff2Bytes)],
  ['PERF-013', kib(homeFirstLoad)],
];

console.log('Valida frontend quality budgets — measured from dist/\n');
console.log('BUILD OUTPUT');
console.log(`  JS    ${js.length} file(s)   raw ${fmt(kib(js.reduce((s, f) => s + sizeOf(f), 0)))}  gzip ${fmt(kib(jsGzip))}`);
console.log(`  CSS   ${css.length} file(s)   raw ${fmt(kib(css.reduce((s, f) => s + sizeOf(f), 0)))}  gzip ${fmt(kib(cssGzip))}`);
console.log(`  woff2 ${woff2.length} file(s)  ${fmt(kib(woff2Bytes))}   (downloaded)`);
console.log(`  woff  ${woff.length} file(s)  ${fmt(kib(woffBytes))}   (emitted fallback, NOT downloaded by woff2-capable browsers)`);
console.log(`\nESTIMATED HOME FIRST-LOAD TRANSFER  ${fmt(kib(homeFirstLoad))}`);
console.log('  = html(gzip) + css(gzip) + js(gzip) + woff2 + eager brand assets');
console.log('  excludes lazily-loaded below-the-fold imagery\n');

console.log('BUDGETS');
let failed = 0;
for (const [id, actual] of results) {
  const { label, limit } = BUDGETS[id];
  const ok = actual <= limit;
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}: ${fmt(actual)} / ${fmt(limit)}`);
}

console.log('\nPRODUCTION FIXTURE ISOLATION');
const textAssets = [...js, ...css].map((f) => readFileSync(join(assetsDir, f), 'utf8')).join('\n') +
  (existsSync(html) ? readFileSync(html, 'utf8') : '');
let leaked = 0;
for (const marker of FIXTURE_MARKERS) {
  const hits = textAssets.split(marker).length - 1;
  if (hits > 0) leaked += 1;
  console.log(`  ${hits === 0 ? 'PASS' : 'FAIL'}  "${marker}": ${hits}`);
}

console.log('\nTHIRD-PARTY RUNTIME');
/*
 * What matters is whether the page LOADS anything from another origin, not
 * whether an absolute URL appears somewhere in a bundled string. Library error
 * messages legitimately embed documentation links (React Router points at
 * reactrouter.com); those are never requested.
 *
 * So the document is checked for external resource references, and the bundles
 * for network calls to an absolute external URL.
 */
const htmlText = existsSync(html) ? readFileSync(html, 'utf8') : '';
const externalResources = [...htmlText.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]);
const externalCalls = [...textAssets.matchAll(/(?:fetch|import)\(\s*["'`](https?:\/\/[^"'`]+)/gi)].map((m) => m[1]);
const thirdParty = [...new Set([...externalResources, ...externalCalls])];
console.log(`  ${thirdParty.length === 0 ? 'PASS' : 'FAIL'}  external resources loaded / called: ${thirdParty.length}`);
thirdParty.forEach((u) => console.log(`    ${u}`));

// Informational only: documentation URLs inside bundled strings are not loads.
const mentioned = [...new Set([...textAssets.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]))]
  .filter((u) => !thirdParty.some((t) => t.startsWith(u)));
console.log(`  INFO  absolute URLs present as inert strings (not requested): ${mentioned.length}`);
mentioned.forEach((u) => console.log(`    ${u}`));

const problems = failed + leaked + thirdParty.length;
console.log(`\n${problems === 0 ? 'ALL QUALITY BUDGET CHECKS PASSED' : `${problems} CHECK(S) FAILED`}`);
process.exit(problems === 0 ? 0 : 1);
