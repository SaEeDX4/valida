#!/usr/bin/env node
/**
 * Renders card.html to a 1200 x 630 PNG: the site's social card, revision 2
 * (OD-2026-11-09-03). Not part of any build; the site serves its own copy of
 * the bytes from frontend/public/social/.
 *
 *   node docs/brand/social-card-preview/render.mjs [--out <file.png>]
 *
 * Without --out it writes valida-social-card-v2-1200x630.png in this folder.
 * Revision 1 (valida-social-card-preview-1200x630.png) is never overwritten.
 *
 * Needs the e2e and frontend dependencies installed (`npm ci` in e2e/ and
 * frontend/): Chromium comes from e2e's @playwright/test, the fonts from
 * frontend's @fontsource packages.
 *
 * The page is loaded from a fake origin, http://card.invalid/, whose requests
 * are answered from files inside this repository only. Every other request is
 * aborted, so the render uses no network and no file:// font loading.
 * The script stops with an error unless the fonts and the logo actually
 * loaded, the card measures exactly 1200 x 630 CSS pixels and its text ends
 * inside the card. It reports the layout (CSS px), including the gap between
 * the logo and the eyebrow line.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const { chromium } = createRequire(path.join(repoRoot, 'e2e', 'package.json'))('@playwright/test');

const outArg = process.argv.indexOf('--out');
const out = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(here, 'valida-social-card-v2-1200x630.png'));
if (path.basename(out) === 'valida-social-card-preview-1200x630.png') throw new Error('refusing to overwrite revision 1 (valida-social-card-preview-1200x630.png)');

const ORIGIN = 'http://card.invalid';
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' };

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const served = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.resolve(repoRoot, `.${decodeURIComponent(url.pathname)}`);
    const type = TYPES[path.extname(file)];
    if (!file.startsWith(repoRoot + path.sep) || !type) return route.abort();
    served.push(path.relative(repoRoot, file).split(path.sep).join('/'));
    return route.fulfill({ status: 200, contentType: type, body: readFileSync(file) });
  });

  await page.goto(`${ORIGIN}/docs/brand/social-card-preview/card.html`, { waitUntil: 'load' });
  const facts = await page.evaluate(async () => {
    await document.fonts.ready;
    const logo = document.querySelector('.logo');
    const box = document.getElementById('card').getBoundingClientRect();
    return {
      fonts: {
        spaceGrotesk600: document.fonts.check('600 76px "Space Grotesk"'),
        inter400: document.fonts.check('400 24px "Inter"'),
        inter500: document.fonts.check('500 15px "Inter"'),
      },
      loadedFaces: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => `${face.family} ${face.weight}`),
      logo: { complete: logo.complete, natural: [logo.naturalWidth, logo.naturalHeight], rendered: [logo.width, logo.height] },
      card: [box.width, box.height],
      layout: (() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const logoBox = rect('.logo');
        const eyebrow = rect('.eyebrow');
        const heading = rect('h1');
        const description = rect('.description');
        const lineHeight = parseFloat(getComputedStyle(document.querySelector('.description')).lineHeight);
        return {
          logoBottom: logoBox.bottom,
          eyebrowTop: eyebrow.top,
          gapLogoToEyebrow: eyebrow.top - logoBox.bottom,
          gapEyebrowToHeading: heading.top - eyebrow.bottom,
          gapHeadingToDescription: description.top - heading.bottom,
          descriptionBottom: description.bottom,
          descriptionLines: Math.round(description.height / lineHeight),
          spaceBelowDescription: box.bottom - description.bottom,
        };
      })(),
    };
  });

  const problems = [];
  if (facts.loadedFaces.length !== 3) problems.push(`expected 3 loaded font faces, got ${JSON.stringify(facts.loadedFaces)}`);
  if (!facts.logo.complete || facts.logo.natural.join('x') !== '1009x230') problems.push(`logo not loaded as 1009x230: ${JSON.stringify(facts.logo)}`);
  if (facts.card.join('x') !== '1200x630') problems.push(`card is ${facts.card.join('x')}, not 1200x630`);
  if (!(facts.layout.descriptionBottom <= 630)) problems.push(`the text ends at ${facts.layout.descriptionBottom}px, outside the card`);
  if (problems.length) throw new Error(`render refused:\n  - ${problems.join('\n  - ')}`);

  const png = await page.locator('#card').screenshot({ type: 'png', animations: 'disabled' });
  writeFileSync(out, png);
  const sha256 = createHash('sha256').update(png).digest('hex');
  console.log(JSON.stringify({ out: path.relative(process.cwd(), out), bytes: png.length, sha256, chromium: browser.version(), served, ...facts }, null, 2));
} finally {
  await browser.close();
}
