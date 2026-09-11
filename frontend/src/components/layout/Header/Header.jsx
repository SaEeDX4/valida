import { Link } from 'react-router';
import Container from '../Container/Container.jsx';
import Button from '../../ui/Button/Button.jsx';
import BrandLogo from './BrandLogo.jsx';
import DesktopNavigation from './DesktopNavigation.jsx';
import MobileNavigation from './MobileNavigation.jsx';
import { HEADER_CTA } from './navItems.js';
import styles from './Header.module.css';

/**
 * Global Header — Doc 05 sections 6-19, Doc 08 section 24.
 *
 * Composition: BrandLogo, DesktopNavigation, HeaderCTA, MobileNavigation.
 *
 * The element is a <header> landmark containing a single <nav> landmark on
 * desktop; the mobile panel supplies its own <nav> when open. Only one is ever
 * mounted at a time, so assistive technology never sees two competing
 * "Primary" navigations.
 *
 * The <header> is the mobile panel's containing block. It is already
 * position: sticky, which is a positioned value, so an absolutely positioned
 * descendant resolves against the header's padding box — full header width,
 * directly below the header bar. Nothing between the header and the panel may
 * be positioned, or the panel would shrink to that element instead. Positioning
 * is owned entirely by the CSS modules; no inline style is used.
 */
export default function Header() {
  return (
    <header className={styles.header}>
      <Container width="wide">
        <div className={styles.inner}>
          <BrandLogo />

          <div className={styles.right}>
            <nav aria-label="Primary" className={styles.desktopOnly}>
              <DesktopNavigation />
            </nav>

            <Button
              as={Link}
              href={HEADER_CTA.to}
              variant="primary"
              size="compact"
              className={styles.desktopCta}
            >
              {HEADER_CTA.label}
            </Button>

            <div className={styles.mobileOnly}>
              <MobileNavigation />
            </div>
          </div>
        </div>
      </Container>
    </header>
  );
}
