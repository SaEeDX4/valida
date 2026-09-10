import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * WCAG 2.2 AA contrast verification.
 *
 * Doc 03 section 86 requires electric-blue combinations to be tested and warns
 * that visual attractiveness does not imply accessibility. Doc 03 section 85
 * forbids claiming compliance before implementation testing.
 *
 * This gate reads the REAL canonical token source, src/styles/tokens.css, and
 * resolves each token by name. It holds no second copy of the palette, so a
 * change to a production token value changes what is tested. If a token is
 * edited into an inaccessible pairing, or renamed, or deleted, this suite
 * fails.
 *
 * It exists because axe-core's colour-contrast rule cannot execute under
 * jsdom: the rule samples rendered pixels from a canvas, which jsdom does not
 * implement, so the component suites do not cover contrast at all.
 *
 * Parsing is done with a small regex rather than a CSS parser dependency
 * (18_IMPLEMENTATION_ROADMAP.md section 23).
 */

const tokensPath = join(dirname(fileURLToPath(import.meta.url)), "tokens.css");
const tokensSource = readFileSync(tokensPath, "utf8");

/** Extracts every `--token: value;` declaration from tokens.css. */
function parseTokens(css) {
  const table = new Map();
  const declaration = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match;
  while ((match = declaration.exec(css)) !== null) {
    table.set(match[1], match[2].trim());
  }
  return table;
}

const TOKENS = parseTokens(tokensSource);

/**
 * Resolves a token name to { rgb, alpha }.
 * Throws if the token is absent, so a renamed or deleted token fails loudly
 * instead of silently skipping a check.
 */
export function resolveToken(name) {
  const raw = TOKENS.get(name);
  if (raw === undefined) {
    throw new Error(`Token ${name} is not defined in tokens.css`);
  }

  const hex = raw.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = Number.parseInt(hex[1], 16);
    return {
      rgb: [(value >> 16) & 255, (value >> 8) & 255, value & 255],
      alpha: 1,
    };
  }

  const short = raw.match(/^#([0-9a-f]{3})$/i);
  if (short) {
    const [r, g, b] = short[1].split("");
    return {
      rgb: [r + r, g + g, b + b].map((pair) => Number.parseInt(pair, 16)),
      alpha: 1,
    };
  }

  const rgba = raw.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i,
  );

  if (rgba) {
    return {
      rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }

  throw new Error(
    `Token ${name} resolves to "${raw}", which is not a colour value.`,
  );
}

/**
 * Flattens a token against whatever renders behind it.
 *
 * A translucent border does not have the contrast of its declared value: the
 * browser composites it over the element's own background (backgrounds extend
 * under the border box by default). Contrast must therefore be measured on the
 * composited result, which is exactly what the earlier version of this gate
 * missed by refusing rgba outright.
 */
export function flatten(tokenName, behindTokenName) {
  const fg = resolveToken(tokenName);

  if (fg.alpha === 1) {
    return fg.rgb;
  }

  if (!behindTokenName) {
    throw new Error(
      `Token ${tokenName} is translucent; a backdrop token is required to composite it.`,
    );
  }

  const behind = resolveToken(behindTokenName);

  if (behind.alpha !== 1) {
    throw new Error(`Backdrop ${behindTokenName} must be opaque.`);
  }

  return fg.rgb.map((c, i) => c * fg.alpha + behind.rgb[i] * (1 - fg.alpha));
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG 2.x contrast ratio between two rgb triples. */
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast between two opaque token names. */
export function contrastRatio(foregroundToken, backgroundToken) {
  return ratio(flatten(foregroundToken), flatten(backgroundToken));
}

/**
 * Contrast of a control boundary against one adjacent colour.
 * `behind` is what the boundary composites over; `adjacent` is the colour it
 * must be distinguishable from.
 */
export function boundaryContrast(borderToken, behindToken, adjacentToken) {
  return ratio(flatten(borderToken, behindToken), flatten(adjacentToken));
}

// [description, foreground token, background token]
const TEXT_PAIRS = [
  ["text-primary on bg-primary", "--color-text-primary", "--color-bg-primary"],
  ["text-primary on surface", "--color-text-primary", "--color-surface"],
  [
    "text-secondary on bg-primary",
    "--color-text-secondary",
    "--color-bg-primary",
  ],
  ["text-secondary on surface", "--color-text-secondary", "--color-surface"],
  [
    "text-secondary on surface-raised",
    "--color-text-secondary",
    "--color-surface-raised",
  ],
  ["text-muted on bg-primary", "--color-text-muted", "--color-bg-primary"],
  ["text-muted on bg-secondary", "--color-text-muted", "--color-bg-secondary"],
  ["text-muted on bg-tertiary", "--color-text-muted", "--color-bg-tertiary"],
  ["text-muted on surface", "--color-text-muted", "--color-surface"],
  ["silver on bg-primary", "--color-silver", "--color-bg-primary"],
  ["accent link on bg-primary", "--color-accent", "--color-bg-primary"],
  ["accent link on surface", "--color-accent", "--color-surface"],
  [
    "accent-bright on bg-primary",
    "--color-accent-bright",
    "--color-bg-primary",
  ],
  ["primary button label, default", "--color-on-accent", "--color-accent"],
  ["primary button label, hover", "--color-on-accent", "--color-accent-bright"],
  [
    "primary button label, active",
    "--color-on-accent-deep",
    "--color-accent-deep",
  ],
  ["error text on bg-primary", "--color-error", "--color-bg-primary"],
  ["error text on surface", "--color-error", "--color-surface"],
  ["success text on bg-primary", "--color-success", "--color-bg-primary"],
  ["warning text on bg-primary", "--color-warning", "--color-bg-primary"],
  ["info text on bg-primary", "--color-info", "--color-bg-primary"],
];

describe("contrast gate reads the real token source", () => {
  it("parsed tokens.css and found the palette", () => {
    expect(TOKENS.size).toBeGreaterThan(40);
    expect(TOKENS.has("--color-accent")).toBe(true);
  });

  it("fails loudly when a token is missing rather than skipping the check", () => {
    expect(() => resolveToken("--color-does-not-exist")).toThrow(
      /not defined in tokens.css/,
    );
  });

  it("parses translucent tokens instead of refusing them", () => {
    const border = resolveToken("--color-border-medium");

    expect(border.alpha).toBeCloseTo(0.2, 5);
    expect(border.rgb).toEqual([190, 210, 230]);
  });

  it("requires a backdrop before flattening a translucent token", () => {
    expect(() => flatten("--color-border-medium")).toThrow(
      /backdrop token is required/,
    );
  });

  it("composites a translucent token over its backdrop", () => {
    // rgba(190, 210, 230, 0.2) over #0e151d.
    expect(
      flatten("--color-border-medium", "--color-surface").map(Math.round),
    ).toEqual([49, 59, 69]);
  });

  it("reads the value actually written in tokens.css", () => {
    expect(resolveToken("--color-accent").rgb).toEqual([0x32, 0x8f, 0xff]);
  });
});

describe("WCAG 2.2 AA contrast — text (4.5:1)", () => {
  it.each(TEXT_PAIRS)("%s", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

/*
 * WCAG 2.2 SC 1.4.11 — non-text contrast.
 *
 * The boundary that identifies a custom control must reach 3:1 against
 * adjacent colours. Each entry is
 * [description, border token, surface the border composites over, adjacent colour].
 *
 * Every control is checked against BOTH neighbours: the page background
 * outside it and its own fill inside it, because a boundary that only clears
 * one side is still hard to locate.
 */
const CONTROL_BOUNDARIES = [
  // Default enabled text input / textarea.
  [
    "input boundary vs page background",
    "--color-control-border",
    "--color-surface",
    "--color-bg-primary",
  ],
  [
    "input boundary vs its own fill",
    "--color-control-border",
    "--color-surface",
    "--color-surface",
  ],

  // Hover.
  [
    "input boundary on hover vs page background",
    "--color-control-border-hover",
    "--color-surface",
    "--color-bg-primary",
  ],

  // Invalid.
  [
    "invalid input boundary vs page background",
    "--color-error",
    "--color-surface",
    "--color-bg-primary",
  ],
  [
    "invalid input boundary vs its own fill",
    "--color-error",
    "--color-surface",
    "--color-surface",
  ],

  // Focused input: the border switches to accent and the fill lifts.
  [
    "focused input boundary vs page background",
    "--color-accent",
    "--color-surface-raised",
    "--color-bg-primary",
  ],
  [
    "focused input boundary vs its own fill",
    "--color-accent",
    "--color-surface-raised",
    "--color-surface-raised",
  ],

  // Secondary button.
  [
    "secondary button boundary vs page background",
    "--color-control-border",
    "--color-surface-raised",
    "--color-bg-primary",
  ],
  [
    "secondary button boundary vs its own fill",
    "--color-control-border",
    "--color-surface-raised",
    "--color-surface-raised",
  ],

  // Icon-only button: transparent fill, so the boundary is the only thing
  // identifying it and it composites straight over the page.
  [
    "icon button boundary vs page background",
    "--color-control-border",
    "--color-bg-primary",
    "--color-bg-primary",
  ],

  // Interactive Surface: once Surface renders as an operable button/link,
  // its boundary is part of the control affordance and must satisfy SC 1.4.11.
  [
    "interactive surface boundary vs page background",
    "--color-control-border",
    "--color-surface",
    "--color-bg-primary",
  ],
  [
    "interactive surface boundary vs its own fill",
    "--color-control-border",
    "--color-surface",
    "--color-surface",
  ],
  [
    "interactive surface hover boundary vs page background",
    "--color-control-border-hover",
    "--color-surface-hover",
    "--color-bg-primary",
  ],
  [
    "interactive surface hover boundary vs its own fill",
    "--color-control-border-hover",
    "--color-surface-hover",
    "--color-surface-hover",
  ],

  // Destructive button.
  [
    "destructive button boundary vs page background",
    "--color-error",
    "--color-bg-primary",
    "--color-bg-primary",
  ],
];

/*
 * The keyboard focus indicator, which is a solid outline drawn outside the
 * control rather than a composited border.
 */
const FOCUS_INDICATORS = [
  ["focus ring against page background", "--color-focus", "--color-bg-primary"],
  ["focus ring against surface", "--color-focus", "--color-surface"],
  [
    "focus ring against surface-raised",
    "--color-focus",
    "--color-surface-raised",
  ],
];

const NON_TEXT_FILLS = [
  [
    "primary button fill against page background",
    "--color-accent",
    "--color-bg-primary",
  ],
];

describe("WCAG 2.2 SC 1.4.11 — control boundaries (3:1)", () => {
  it.each(CONTROL_BOUNDARIES)("%s", (_label, border, behind, adjacent) => {
    expect(boundaryContrast(border, behind, adjacent)).toBeGreaterThanOrEqual(
      3,
    );
  });
});

describe("WCAG 2.2 SC 1.4.11 — focus indicator (3:1)", () => {
  it.each(FOCUS_INDICATORS)("%s", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("WCAG 2.2 SC 1.4.11 — non-text fills (3:1)", () => {
  it.each(NON_TEXT_FILLS)("%s", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("decorative borders are deliberately exempt", () => {
  it("documents that the subtle border tokens do not identify a control", () => {
    // Doc 03 section 37 defines these as thin, subtle container outlines.
    // They are used by static/non-interactive Surface instances, Alert and
    // EmptyState, where the border does not identify an actionable control.
    //
    // Interactive Surface instances are intentionally excluded from this
    // exemption and are tested above using --color-control-border /
    // --color-control-border-hover.
    //
    // The subtle decorative tokens are intentionally below 3:1 and must NOT
    // be strengthened; interactive controls use the semantic control-border
    // tokens instead. This test records that decision so a future reader does
    // not "fix" the wrong token.
    const subtleOverSurface = ratio(
      flatten("--color-border-subtle", "--color-surface"),
      flatten("--color-bg-primary"),
    );

    expect(subtleOverSurface).toBeLessThan(3);
  });
});

describe("accent-deep regression", () => {
  it("confirms the dark accent label is genuinely unusable on accent-deep", () => {
    // Documents why --color-on-accent-deep exists. If a future palette change
    // makes this pass, the extra token can be retired deliberately rather than
    // by accident.
    expect(
      contrastRatio("--color-on-accent", "--color-accent-deep"),
    ).toBeLessThan(4.5);
  });
});
