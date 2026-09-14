/**
 * Service registry — the single seam through which controlled development
 * fixtures may replace a real API module.
 *
 * Nothing here reads configuration or decides anything. An override must be
 * installed explicitly by dev-only bootstrap code (src/dev/installDevFixtures.js),
 * which itself runs only behind the two-condition gate in config/env.js.
 *
 * WHY A REGISTRY RATHER THAN A CONDITIONAL IMPORT
 * A conditional `import` of the fixture module would keep the fixtures inside
 * the production module graph. With this seam the production bundle imports
 * only the real API modules; nothing in the shipped graph references a fixture
 * at all.
 *
 * An override can only ever be set by that bootstrap, never by a failed
 * request. There is deliberately no "fall back to fixtures on error" path
 * anywhere in this codebase.
 */

const overrides = new Map();

/** Installs a replacement implementation. Development and tests only. */
export function setServiceOverride(name, implementation) {
  overrides.set(name, implementation);
}

/** Removes an override. Used by test cleanup. */
export function clearServiceOverrides() {
  overrides.clear();
}

/** Returns the override for `name`, or the supplied real implementation. */
export function resolveService(name, realImplementation) {
  return overrides.get(name) ?? realImplementation;
}

export const SERVICE = {
  JOBS: 'jobs',
  APPLICATIONS: 'applications',
};
