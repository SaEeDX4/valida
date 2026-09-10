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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
