import AppRouter from '../routes/AppRouter.jsx';

/**
 * Root application component.
 *
 * MILESTONE A3
 * App now hosts the real application shell and router, as Doc 08 section 14
 * describes. It replaced the A2 Design System Preview as the entry point.
 *
 * The preview component and its tests remain in the repository unchanged —
 * they are an approved A2 engineering surface and are still exercised by
 * DesignSystemPreview.test.jsx. They are simply no longer mounted by the
 * application, because the application now renders the real site shell.
 */
export default function App() {
  return <AppRouter />;
}
