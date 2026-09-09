import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
export default defineConfig({
  plugins: [react()],

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
