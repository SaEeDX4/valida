import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Static hygiene checks on the files A4 created or rewrote.
 *
 * Doc 08 section 7 makes CSS Modules the styling strategy for scoped page and
 * component styles. Inline style attributes bypass that: they cannot be
 * themed, cannot use media queries, and drift away from the token system.
 *
 * Scoped deliberately to A4's own files. Locked A1/A2/A3 components are not
 * inspected here — they are out of scope for this milestone and must not be
 * refactored for stylistic reasons.
 */
const pagesDir = dirname(fileURLToPath(import.meta.url));
const proseDir = join(pagesDir, '..', 'components', 'content', 'Prose');
const seoDir = join(pagesDir, '..', 'components', 'seo');

const A4_FILES = [
  join(pagesDir, 'HomePage.jsx'),
  join(pagesDir, 'AboutPage.jsx'),
  join(pagesDir, 'PrivacyPage.jsx'),
  join(pagesDir, 'LegalPage.jsx'),
  join(pagesDir, 'HomePage.content.js'),
  join(pagesDir, 'AboutPage.content.js'),
  join(pagesDir, 'PrivacyPage.content.js'),
  join(pagesDir, 'LegalPage.content.js'),
  join(proseDir, 'Prose.jsx'),
  join(seoDir, 'PageMeta.jsx'),
];

describe('A4 style hygiene', () => {
  it.each(A4_FILES.map((file) => [file.split('/').slice(-1)[0], file]))(
    '%s contains no inline style attribute',
    (_name, file) => {
      expect(readFileSync(file, 'utf8')).not.toMatch(/style=\{\{/);
    },
  );

  it('uses no display:contents styling workaround in code', () => {
    // Matches the JS style-object form only, so prose in comments that merely
    // mentions the workaround does not trip the check.
    A4_FILES.forEach((file) => {
      expect(readFileSync(file, 'utf8')).not.toMatch(/display:\s*['"`]contents['"`]/);
    });
  });

  it('pairs every A4 page with a CSS module rather than ad-hoc styling', () => {
    const modules = readdirSync(pagesDir).filter((f) => f.endsWith('.module.css'));
    ['HomePage.module.css', 'AboutPage.module.css', 'LegalDocument.module.css'].forEach((m) =>
      expect(modules).toContain(m),
    );
  });
});
