import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * A6 correction 1 — cross-platform path handling in quality tooling.
 *
 * `new URL(..., import.meta.url).pathname` is not a filesystem path. On Windows
 * it yields "/C:/Users/..." (leading slash before the drive letter) and on every
 * OS it leaves spaces as %20, so fs calls fail. Authoritative QA runs on
 * Windows, where the budget gate would have reported "dist/ not found" after a
 * successful build.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(SRC, '..');
const SCRIPT = join(FRONTEND, 'scripts', 'check-quality-budgets.mjs');

/** Every Node-executed source the A6 tooling ships. */
function toolingSources() {
  const scripts = readdirSync(join(FRONTEND, 'scripts'))
    .filter((f) => /\.(mjs|cjs|js)$/.test(f))
    .map((f) => join(FRONTEND, 'scripts', f));
  const tests = readdirSync(join(SRC, 'test'))
    .filter((f) => /\.(js|jsx)$/.test(f))
    .map((f) => join(SRC, 'test', f));
  return [...scripts, ...tests];
}

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('A6 tooling — filesystem paths come from fileURLToPath', () => {
  it.each(toolingSources().map((f) => [f.slice(FRONTEND.length + 1), f]))(
    '%s never uses URL#pathname as a filesystem path',
    (_name, file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      // A URL built from import.meta.url must not be turned into a path by
      // reading .pathname.
      expect(code).not.toMatch(/import\.meta\.url\s*\)\s*\.pathname/);
      expect(code).not.toMatch(/new URL\([^)]*\)\s*\.pathname/);
    },
  );

  it('the budget gate resolves dist/ with fileURLToPath', () => {
    const code = stripComments(readFileSync(SCRIPT, 'utf8'));
    expect(code).toMatch(/import \{ fileURLToPath \} from 'node:url'/);
    expect(code).toMatch(/fileURLToPath\(new URL\('\.\.\/dist\/', import\.meta\.url\)\)/);
  });
});

describe('A6 tooling — the budget gate runs from a path containing a space', () => {
  /*
   * Behavioural proof rather than a pattern match. The real script is copied
   * into a temporary checkout whose path contains a space, next to a minimal
   * synthetic dist/. URL#pathname would keep the space as %20 and fail to find
   * dist/ (exit 2); fileURLToPath finds it (exit 0). This reproduces the Windows
   * failure class on any OS.
   */
  const root = mkdtempSync(join(tmpdir(), 'valida path with space '));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('finds dist/ and completes', () => {
    const frontend = join(root, 'frontend');
    mkdirSync(join(frontend, 'scripts'), { recursive: true });
    mkdirSync(join(frontend, 'dist', 'assets'), { recursive: true });
    mkdirSync(join(frontend, 'dist', 'brand'), { recursive: true });
    copyFileSync(SCRIPT, join(frontend, 'scripts', 'check-quality-budgets.mjs'));
    writeFileSync(join(frontend, 'dist', 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(frontend, 'dist', 'assets', 'index.js'), 'console.log(1);');
    writeFileSync(join(frontend, 'dist', 'assets', 'index.css'), 'body{}');

    const result = spawnSync(process.execPath, [join(frontend, 'scripts', 'check-quality-budgets.mjs')], {
      encoding: 'utf8',
    });

    expect(root).toMatch(/ /);
    expect(result.stderr).not.toMatch(/dist\/ not found/);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
