import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveSeoConfig, seoBuildProblems } from './src/seo/siteConfig.js';

/**
 * Valida frontend build configuration.
 *
 * Governed by:
 *   08_FRONTEND_SPEC.md  — React + Vite + JavaScript, canonical root structure
 *   15_DEVOPS_DEPLOYMENT.md section 62 — canonical Vite output directory is dist/
 *
 * Ports are pinned with strictPort so a busy port fails loudly instead of
 * silently moving the dev server to a different URL. That keeps the documented
 * verification URLs in README.md accurate.
 */

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The file the document server reads to render the same head as this bundle (frontend/server/). */
export const SEO_MANIFEST_FILE = 'valida-seo.json';

/**
 * C4 — SEO configuration of the build.
 *
 * 1. The build REFUSES an incoherent configuration (src/seo/siteConfig.js):
 *    VITE_ALLOW_INDEXING other than "true"/"false", or an indexable build
 *    without a valid https:// canonical origin. Nothing is guessed.
 * 2. It writes dist/valida-seo.json: the canonical origin, whether the build is
 *    indexable, and the API origin compiled into the bundle. The document
 *    server takes its configuration from this file, so the initial HTML and the
 *    browser can never be configured differently. Every value in it is already
 *    public in the bundle.
 */
function validaSeoConfig() {
  let env = {};
  return {
    name: 'valida-seo-config',
    configResolved(config) {
      env = loadEnv(config.mode, ROOT, 'VITE_');
      if (config.command !== 'build') return;
      const problems = seoBuildProblems({ siteUrl: env.VITE_PUBLIC_SITE_URL, allowIndexing: env.VITE_ALLOW_INDEXING });
      if (problems.length > 0) throw new Error(`Valida SEO configuration refused:\n  - ${problems.join('\n  - ')}`);
    },
    generateBundle() {
      const seo = resolveSeoConfig({ siteUrl: env.VITE_PUBLIC_SITE_URL, allowIndexing: env.VITE_ALLOW_INDEXING });
      this.emitFile({
        type: 'asset',
        fileName: SEO_MANIFEST_FILE,
        source: `${JSON.stringify(
          {
            indexing: seo.indexing,
            siteOrigin: seo.siteOrigin,
            apiBaseUrl: (env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '').replace(/\/api\/v\d+$/, ''),
          },
          null,
          2,
        )}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), validaSeoConfig()],

  server: {
    port: 5173,
    strictPort: true,
  },

  preview: {
    port: 4173,
    strictPort: true,
  },

  build: {
    outDir: 'dist',
    // Source maps stay off by default; the production decision is finalised
    // with deployment in Release C (15_DEVOPS_DEPLOYMENT.md).
    sourcemap: false,
  },
});
