import { readFileSync } from 'node:fs';

/**
 * C6-T5 — test instruments for pages served under the enforced
 * Content-Security-Policy (frontend/server/securityHeaders.js).
 *
 * The policy allows no inline script and no inline style, so Playwright's
 * page.addScriptTag({ path }) and page.addStyleTag({ content }) — which
 * insert an inline <script>/<style> element — are refused by the browser,
 * exactly as an injected script or style would be in production. The suites
 * do not switch the policy off (no bypassCSP). Their instruments instead
 * enter through channels that are not page content:
 *
 *   - a script file (axe-core) is evaluated through the DevTools protocol
 *     (page.evaluate), the channel @axe-core/playwright itself uses;
 *   - a test stylesheet is a constructable CSSStyleSheet adopted by the
 *     document (CSSOM), not a <style> element.
 *
 * Neither weakens the policy for the site's own resources: those are still
 * loaded, and still checked, under the enforced policy.
 */
const sources = new Map();

/** Evaluates a script FILE in the page (e.g. axe-core's axe.min.js). */
export async function injectScriptFile(page, file) {
  if (!sources.has(file)) sources.set(file, readFileSync(file, 'utf8'));
  await page.evaluate(sources.get(file));
}

/**
 * Adds a test stylesheet to the current document. Returns { remove() }.
 * Same effect on the cascade as page.addStyleTag({ content }).
 */
export async function addTestStyle(page, css) {
  const index = await page.evaluate((text) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    window.__qaTestSheets = window.__qaTestSheets ?? [];
    window.__qaTestSheets.push(sheet);
    return window.__qaTestSheets.length - 1;
  }, css);
  return {
    remove: () =>
      page.evaluate((i) => {
        const sheet = window.__qaTestSheets?.[i];
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      }, index),
  };
}
