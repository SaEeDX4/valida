import { Link } from 'react-router';
import Container from '../Container/Container.jsx';
import TextLink from '../../ui/TextLink/TextLink.jsx';
import { ROUTES } from '../../../routes/paths.js';
import styles from './Footer.module.css';

/* Approved symbol-only mark, served from public/ by root-absolute URL. */
const MARK_TRANSPARENT = '/brand/valida-mark-transparent-512.png';

/**
 * Global Footer — Doc 05 sections 163-167, Doc 04 sections 9 and 58.
 *
 * Groups follow the canonical Phase 1 footer IA: Brand, Company, Legal.
 *
 * The Contact group defined by Doc 04 section 58 and Doc 06 section 193 is
 * deliberately ABSENT. Document 06 permits a contact entry only once a
 * functioning approved contact mechanism exists, explicitly forbids publishing
 * a literal info@<domain>, and Doc 04 section 58 forbids building empty footer
 * categories. The corporate contact identity arrives in Phase 2, so inventing
 * one here would be a fabricated capability. This is tracked as AWAITING INPUT.
 *
 * Every string below is canonical: the brand description is Document 06
 * section 190, the group headings and links are sections 191-192, and the
 * copyright is section 194. No address, phone, certification, client,
 * regulatory status or capability claim appears anywhere.
 */
export default function Footer() {
  // Doc 06 section 194: the year is dynamic, not hard-coded.
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <Container width="wide">
        <div className={styles.grid}>
          <div className={styles.brand}>
            {/* Approved symbol-only mark, used unmodified. */}
            <img
              className={styles.brandMark}
              src={MARK_TRANSPARENT}
              alt="Valida"
              width="512"
              height="512"
              loading="lazy"
              decoding="async"
            />
            <p className={`t-body-sm ${styles.brandText}`}>
              Cybersecurity, secure technology, and security-first engineering.
            </p>
          </div>

          <nav aria-label="Company">
            <h2 className={`t-label ${styles.groupHeading}`}>Company</h2>
            <ul className={styles.list}>
              <li>
                <TextLink as={Link} to={ROUTES.ABOUT} variant="quiet" className="t-body-sm">
                  About
                </TextLink>
              </li>
              <li>
                <TextLink as={Link} to={ROUTES.CAREERS} variant="quiet" className="t-body-sm">
                  Careers
                </TextLink>
              </li>
            </ul>
          </nav>

          <nav aria-label="Legal">
            <h2 className={`t-label ${styles.groupHeading}`}>Legal</h2>
            <ul className={styles.list}>
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

        <div className={styles.bottom}>
          <p className={`t-caption ${styles.copyright}`}>
            © {currentYear} Valida MB. All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  );
}
