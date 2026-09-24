import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/**
 * A6 static quality guards.
 *
 * These assert properties of the real shipped source that jsdom cannot observe:
 * whether animated components actually honour reduced motion, whether long
 * content can wrap, and whether fixed heights threaten reflow at zoom.
 *
 * They are structural, not visual. They do NOT prove layout — browser evidence
 * is still required for that and is listed in the A6 QA matrix.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, predicate, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      walk(full, predicate, found);
    } else if (predicate(full)) {
      found.push(full);
    }
  }

  return found;
}

const cssFiles = walk(SRC, (f) => f.endsWith(".css"));
const read = (f) => readFileSync(f, "utf8");
const rel = (f) => relative(SRC, f);

describe("A6 — reduced motion is honoured by the components that animate", () => {
  /**
   * A global reduced-motion rule exists in base.css, but a global rule is not
   * proof: a component can still start JavaScript-driven motion, and a
   * stylesheet that defines its own keyframes should say what happens when
   * motion is reduced rather than relying entirely on the global override.
   */
  const animating = cssFiles.filter((f) =>
    /@keyframes|animation:/.test(read(f)),
  );

  it("finds the stylesheets that animate", () => {
    expect(animating.length).toBeGreaterThan(0);
  });

  it.each(animating.map((f) => [rel(f), f]))(
    "%s declares its own reduced-motion behaviour",
    (_name, file) => {
      expect(read(file)).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    },
  );

  it("keeps the global reduced-motion reset in base.css", () => {
    const base = read(join(SRC, "styles", "base.css"));

    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(base).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(base).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it("gates JavaScript-driven ambient motion behind the preference", () => {
    // The Security Field must not merely stop via CSS; it must never start.
    const field = read(
      join(SRC, "components", "graphics", "SecurityField", "SecurityField.jsx"),
    );

    expect(field).toMatch(/usePrefersReducedMotion/);

    const hook = read(join(SRC, "hooks", "usePrefersReducedMotion.js"));

    expect(hook).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe("A6 — horizontal overflow risk", () => {
  /**
   * Page-level horizontal scrolling is prohibited. jsdom performs no layout, so
   * these check the structural causes: a global overflow guard, wrapping for
   * unbounded strings, and the absence of fixed pixel widths on page-level
   * containers.
   */
  it("keeps the global overflow-x guard and word-breaking defaults", () => {
    const base = read(join(SRC, "styles", "base.css"));

    expect(base).toMatch(/overflow-x:\s*clip/);
    expect(base).toMatch(/overflow-wrap:\s*break-word/);
  });

  it("allows unbounded user/API strings to wrap", () => {
    // Job titles, filenames and market lists are the strings that can be
    // arbitrarily long and are the known overflow sources.
    const mustWrap = [
      [
        "features/jobs/components/JobRow.module.css",
        /overflow-wrap:\s*anywhere/,
      ],
      [
        "features/applications/components/ResumeField.module.css",
        /overflow-wrap:\s*anywhere/,
      ],
      ["pages/JobDetailPage.module.css", /overflow-wrap:\s*anywhere/],
      ["pages/ApplyPage.module.css", /overflow-wrap:\s*anywhere/],
    ];

    mustWrap.forEach(([file, pattern]) => {
      expect(read(join(SRC, file))).toMatch(pattern);
    });
  });

  it("declares no fixed pixel width on a layout container", () => {
    // max-inline-size is fine; a hard inline-size in px is what breaks narrow
    // viewports and zoom.
    cssFiles.forEach((file) => {
      const offenders = [
        ...read(file).matchAll(
          /(?<!max-|min-)(?:inline-size|width):\s*(\d{3,})px/g,
        ),
      ];

      expect(
        offenders.map((m) => m[0]),
        `fixed width in ${rel(file)}`,
      ).toEqual([]);
    });
  });

  it("constrains media so images cannot widen the page", () => {
    expect(read(join(SRC, "styles", "base.css"))).toMatch(/max-width:\s*100%/);
  });
});

describe("A6 — zoom and reflow risk", () => {
  /**
   * At 200-400% zoom a fixed block-size clips content. Height constraints are
   * only safe when paired with a scroll affordance or expressed in viewport
   * units that shrink with the layout.
   */
  it("pairs every fixed block-size constraint with a scroll affordance", () => {
    cssFiles.forEach((file) => {
      const source = read(file);
      const blocks = source.split("}");

      blocks.forEach((block) => {
        const fixedHeight =
          /(?:^|[\s;{])(?:block-size|height):\s*(\d{3,})px/.exec(block);

        if (!fixedHeight) {
          return;
        }

        const safe = /overflow(-y)?:\s*(auto|scroll)/.test(block);

        expect(
          safe,
          `fixed height without scroll in ${rel(file)}: ${block
            .trim()
            .slice(0, 80)}`,
        ).toBe(true);
      });
    });
  });

  it("caps viewport-relative heights against the header rather than the full screen", () => {
    // A 100dvh panel under a sticky header always overflows by the header height.
    const jobDetail = read(join(SRC, "pages", "JobDetailPage.module.css"));

    expect(jobDetail).toMatch(
      /max-block-size:\s*calc\(100dvh - var\(--header-block-size\)/,
    );

    expect(jobDetail).toMatch(
      /inset-block-start:\s*calc\(var\(--header-block-size\)/,
    );
  });

  it("uses relative units for typography so text resize works", () => {
    const typography = read(join(SRC, "styles", "typography.css"));

    expect(typography).not.toMatch(/font-size:\s*\d+px/);

    const tokens = read(join(SRC, "styles", "tokens.css"));

    // The fluid scale is clamp()-based in rem/vw, never fixed px.
    expect(tokens).toMatch(/--text-body:\s*clamp\(/);
  });
});

describe("A6 — production source hygiene", () => {
  /*
   * Node's path helpers return platform-native separators:
   *
   * Windows:  features\jobs\...
   * POSIX:    features/jobs/...
   *
   * Split relative paths on BOTH separator styles so dev/ and test/ exclusions
   * work identically on Windows, Linux and macOS.
   */
  const productionFiles = walk(SRC, (f) => {
    const pathParts = rel(f).split(/[\\/]/);

    return (
      /\.(jsx?|css)$/.test(f) &&
      !f.includes(".test.") &&
      !pathParts.includes("dev") &&
      !pathParts.includes("test")
    );
  });

  it("ships no third-party runtime script reference", () => {
    productionFiles.forEach((file) => {
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

      expect(source, `external script in ${rel(file)}`).not.toMatch(
        /<script[^>]+src=["']https?:/i,
      );

      expect(source, `external font service in ${rel(file)}`).not.toMatch(
        /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.|unpkg\.com|jsdelivr/i,
      );
    });
  });

  it("references no analytics, tracking, replay or chat widget", () => {
    productionFiles.forEach((file) => {
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

      [
        /gtag\(/,
        /googletagmanager/i,
        /analytics\./i,
        /hotjar/i,
        /sentry/i,
        /intercom/i,
        /segment\.io/i,
      ].forEach((pattern) => {
        expect(source, `${pattern} in ${rel(file)}`).not.toMatch(pattern);
      });
    });
  });

  it("exposes no secret-shaped environment variable to the browser", () => {
    // Comments stripped: the file documents which names must never appear,
    // and that documentation is not itself a leak.
    const env = read(join(SRC, "config", "env.js"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(env).not.toMatch(
      /SECRET|PASSWORD|MONGODB|PRIVATE_KEY|ACCESS_KEY|TOKEN/i,
    );
  });

  it("keeps every fixture reference out of production modules", () => {
    /*
     * main.jsx is the single deliberate exception: it holds the DEV-gated
     * dynamic import that installs fixtures. Excluding it here and asserting
     * its gate separately is the point — one audited entry point, and no other
     * module may reach the fixtures at all.
     */
    productionFiles
      .filter((file) => !file.endsWith("main.jsx"))
      .forEach((file) => {
        const source = read(file)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");

        expect(source, `fixture reference in ${rel(file)}`).not.toMatch(
          /devJobFixtures|installDevFixtures|DEV FIXTURE/,
        );
      });
  });

  it("installs fixtures only from main.jsx, behind a statically foldable gate", () => {
    const main = read(join(SRC, "main.jsx"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    // Written inline so Vite folds DEV to `false` and Rollup drops the chunk.
    expect(main).toMatch(
      /import\.meta\.env\.DEV && import\.meta\.env\.VITE_ENABLE_A5_FIXTURES === 'true'/,
    );

    expect(main).toMatch(/import\('\.\/dev\/installDevFixtures\.js'\)/);

    // Never a static top-level import, which would bundle it unconditionally.
    expect(main).not.toMatch(/^import .*installDevFixtures/m);
  });
});
