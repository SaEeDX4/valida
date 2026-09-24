import { Outlet } from 'react-router';
import SkipLink from '../components/layout/SkipLink/SkipLink.jsx';
import Header from '../components/layout/Header/Header.jsx';
import Footer from '../components/layout/Footer/Footer.jsx';
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
 * SCOPE: every Phase 1 route EXCEPT Apply. The Apply route uses the separate
 * ApplyLayout (Doc 08 section 23), which removes the marketing navigation and
 * full footer during application completion. Both shells keep the same
 * SkipLink and #main-content target; route-change focus handling is a single
 * instance mounted above both layouts in AppRoutes.
 */
export default function PublicLayout() {
  return (
    <div className={styles.shell}>
      <SkipLink />
      <Header />
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
