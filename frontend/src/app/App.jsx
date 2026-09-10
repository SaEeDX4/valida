import DesignSystemPreview from './DesignSystemPreview.jsx';

/**
 * Root application component.
 *
 * MILESTONE A2 SCOPE
 * A2 delivers the design system as reusable primitives. The Router,
 * PublicLayout, Header, Footer and the real pages arrive in A3/A4, at which
 * point this component becomes the router host described in Doc 08 section 14.
 *
 * Until then App renders the Design System Preview: an engineering surface
 * that exercises every primitive so the visual states required by
 * 18_IMPLEMENTATION_ROADMAP.md section 51 can actually be reviewed and
 * screenshotted. It is not website content and contains no company claims.
 */
export default function App() {
  return <DesignSystemPreview />;
}
