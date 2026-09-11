import { Link } from 'react-router';
import { ROUTES } from '../../../routes/paths.js';
import styles from './BrandLogo.module.css';

/*
 * Approved asset, referenced by root-absolute URL. Vite serves files in
 * public/ verbatim at the site root; they are deliberately NOT imported as
 * modules, because Vite does not hash or transform them and the documented
 * pattern is a plain absolute URL.
 */
const LOGO_HORIZONTAL = '/brand/valida-logo-horizontal-transparent.png';

/**
 * BrandLogo — the approved Valida identity in the global header.
 *
 * Uses the approved asset pack at frontend/public/brand/ unmodified. The brand
 * README names valida-logo-horizontal-transparent.png as the preferred
 * header/navbar lockup on dark surfaces, which is exactly this context.
 *
 * The mark is never redrawn, recoloured, distorted or approximated in SVG
 * (brand pack rules 1-2, and the A3 authorization). Aspect ratio is preserved
 * by fixing height and letting width follow.
 *
 * Doc 05 section 10: the logo returns to /, is keyboard focusable and carries
 * an accessible name. The accessible name is the canonical string from
 * Document 06 section 8 — "Valida — Home" — so screen-reader users are told
 * both the identity and the destination. The image itself therefore carries an
 * empty alt: the link already names it, and repeating it would announce twice.
 */
export default function BrandLogo({ className = '' }) {
  return (
    <Link
      to={ROUTES.HOME}
      className={`${styles.logoLink} ${className}`.trim()}
      aria-label="Valida — Home"
    >
      <img
        className={styles.logo}
        src={LOGO_HORIZONTAL}
        alt=""
        width="1009"
        height="230"
        decoding="async"
        // The header lockup is above the fold and is part of the initial
        // identity, so it is not lazy-loaded (Doc 08 section 150).
        fetchPriority="high"
      />
    </Link>
  );
}
