/**
 * Root application component.
 *
 * Canonical location src/app/App.jsx per 08_FRONTEND_SPEC.md section 11.
 * (18_IMPLEMENTATION_ROADMAP.md section 33 writes "frontend/src/App.jsx" but
 * defers to Document 08 canonical architecture for exact filenames.)
 *
 * MILESTONE A1 SCOPE
 * This component exists to prove the React/Vite runtime starts and builds.
 * It is an engineering runtime check, NOT website content, and it is replaced
 * in Milestone A3 by the Router and PublicLayout.
 *
 * It intentionally contains no brand styling, no marketing copy and no company
 * claims. Design tokens land in A2 (Document 03); real production copy lands in
 * A4 (Document 06); both are governed by 02_BRAND_TRUTH_AND_CLAIMS.md.
 */
export default function App() {
  return (
    <main>
      <h1>Valida — frontend runtime foundation</h1>
      <p>
        React and Vite are running. This screen is the Milestone A1 runtime
        check and is replaced by the application shell in Milestone A3.
      </p>
      <ul>
        <li>Release A — Milestone A1 — Repository &amp; Runtime Foundation</li>
        <li>Next: A2 design system, then A3 app shell and routing</li>
      </ul>
    </main>
  );
}
