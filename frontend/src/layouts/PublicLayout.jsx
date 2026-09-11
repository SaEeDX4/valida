import { Outlet } from 'react-router';
import SkipLink from '../components/layout/SkipLink/SkipLink.jsx';
import Header from '../components/layout/Header/Header.jsx';
import Footer from '../components/layout/Footer/Footer.jsx';
import RouteChangeHandler from '../routes/RouteChangeHandler.jsx';
import styles from './PublicLayout.module.css';

/**
 * PublicLayout — Doc 08 section 22.
 *
 * SkipLink, Header, main route outlet, Footer. It renders no page content of
 * its own.
 *
 * The #main-content id is the SkipLink target required by Doc 08 sections
 * 28-29. tabIndex={-1} makes it programmatically focusable so both the skip
 * link and the route-change handler can move focus here.
 *
 * NOTE ON ApplyLayout: Doc 08 section 23 defines a simplified ApplyLayout for
 * the Apply route. It is deliberately NOT built in A3 — Doc 18 section 57
 * lists only PublicLayout, and the layout exists to reduce distraction during
 * application completion, which has no content until A5. The Apply route
 * therefore renders inside PublicLayout for now. Tracked as an explicit
 * deferral to A5.
 */
export default function PublicLayout() {
  return (
    <div className={styles.shell}>
      <RouteChangeHandler />
      <SkipLink />
      <Header />
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
