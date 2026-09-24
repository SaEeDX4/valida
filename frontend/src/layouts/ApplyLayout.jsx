import { Link, Outlet } from 'react-router';
import SkipLink from '../components/layout/SkipLink/SkipLink.jsx';
import BrandLogo from '../components/layout/Header/BrandLogo.jsx';
import Container from '../components/layout/Container/Container.jsx';
import TextLink from '../components/ui/TextLink/TextLink.jsx';
import useActiveRegion from '../features/jobs/hooks/useActiveRegion.js';
import { ROUTES } from '../routes/paths.js';
import styles from './ApplyLayout.module.css';

/**
 * ApplyLayout — the shell for the Apply route only.
 *
 * Doc 08 section 23 defines it as SkipLink, SimplifiedHeader, the main route
 * outlet and ReducedFooter, to reduce distraction during application
 * completion. Doc 05 sections 107-111 set the principle — trust, clarity,
 * completion; not a marketing page — and allow the header only the logo,
 * minimal navigation and a way back to the job or Careers.
 *
 * What is deliberately ABSENT compared with PublicLayout:
 * - the primary marketing navigation (Home / About / Careers),
 * - the "Explore Careers" call to action,
 * - the mobile menu,
 * - the full footer with its company description and Company group.
 * Each is a route away from a half-completed form.
 *
 * What is deliberately KEPT:
 * - SkipLink and the #main-content target, so keyboard and screen-reader users
 *   can bypass the header exactly as on every other route;
 * - identical focus and scroll behaviour on navigation, via the single
 *   RouteChangeHandler mounted above both layouts in AppRoutes;
 * - the approved BrandLogo, unchanged, linking Home;
 * - one "Back to Careers" link, which carries the active ?region= so the
 *   visitor returns to the same regional view (the page itself keeps the
 *   job-specific "Back to Role" link, which knows the role's title);
 * - Privacy and Legal, because a candidate submitting personal data must be
 *   able to reach them. Region is NOT added to these: they are not part of the
 *   regional Careers flow.
 *
 * The Apply page and all of its states render through the Outlet unchanged.
 */
export default function ApplyLayout() {
  const { withRegion } = useActiveRegion();
  const currentYear = new Date().getFullYear();

  return (
    <div className={styles.shell}>
      <SkipLink />

      <header className={styles.header}>
        <Container width="wide">
          <div className={styles.headerInner}>
            <BrandLogo />
            <nav aria-label="Application">
              <TextLink as={Link} to={withRegion(ROUTES.CAREERS)} variant="quiet" className="t-body-sm">
                Back to Careers
              </TextLink>
            </nav>
          </div>
        </Container>
      </header>

      <main id="main-content" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>

      <footer className={styles.footer}>
        <Container width="wide">
          <div className={styles.footerInner}>
            <p className={`t-caption ${styles.copyright}`}>
              © {currentYear} Valida MB. All rights reserved.
            </p>
            <nav aria-label="Legal">
              <ul className={styles.legalList}>
                <li>
                  <TextLink as={Link} to={ROUTES.PRIVACY} variant="quiet" className="t-body-sm">
                    Privacy
                  </TextLink>
                </li>
                <li>
                  <TextLink as={Link} to={ROUTES.LEGAL} variant="quiet" className="t-body-sm">
                    Legal
                  </TextLink>
                </li>
              </ul>
            </nav>
          </div>
        </Container>
      </footer>
    </div>
  );
}
