import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts (Doc 16 section 256 — self-hosting preferred; both
// families are SIL OFL-1.1). Only the weights required by Doc 03 section 24
// and Doc 08 section 44 are loaded.
// Latin subset only: the default entry points bundle cyrillic, greek and
// vietnamese as well, which shipped ~1.3 MB of unused fonts. Doc 03 section 94
// requires subsetting and the minimum necessary weights.
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';

// Global stylesheets, in cascade order (Doc 08 sections 8 and 13).
import './styles/tokens.css';
import './styles/base.css';
import './styles/typography.css';
import './styles/utilities.css';

import App from './app/App.jsx';
/*
 * Controlled A5 development fixtures.
 *
 * Two conditions must both hold: import.meta.env.DEV AND an explicit
 * VITE_ENABLE_A5_FIXTURES opt-in. This is the ONLY place fixtures can be
 * installed — no error handler, no request failure and no query string can
 * reach it on its own.
 *
 * WHY THE CONDITION IS WRITTEN INLINE RATHER THAN CALLED
 * Vite statically replaces import.meta.env.DEV with the literal `false` when
 * building, so this becomes `if (false && ...)` and Rollup eliminates the whole
 * branch, dropping the dynamic import and the fixture chunk from the bundle
 * entirely. Calling a helper here would hide the constant behind a function
 * boundary, defeat that analysis, and ship the fixture code.
 *
 * WHY INSTALLATION IS AWAITED BEFORE RENDER
 * The dynamic import resolves asynchronously. Rendering immediately after it
 * was started created a race: React could mount, a page effect could run, and
 * the REAL service could be called before the overrides were installed —
 * making controlled browser QA non-deterministic. Awaiting the installer means
 * the first render already sees the fixture services.
 */
async function bootstrap() {
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_A5_FIXTURES === 'true') {
    const { default: installDevFixtures } = await import('./dev/installDevFixtures.js');
    installDevFixtures();
  }

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();
