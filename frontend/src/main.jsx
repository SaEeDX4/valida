import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.jsx';

/**
 * Frontend bootstrap.
 *
 * Responsibility: mount the React application into #root and nothing else.
 * Canonical location src/main.jsx per 08_FRONTEND_SPEC.md section 11.
 *
 * The Router, PublicLayout, design tokens and global stylesheets are added in
 * Milestones A2 and A3. They are deliberately absent here.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
