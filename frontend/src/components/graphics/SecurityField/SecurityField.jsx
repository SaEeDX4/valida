import usePrefersReducedMotion from '../../../hooks/usePrefersReducedMotion.js';
import styles from './SecurityField.module.css';

/**
 * Valida Security Field — the Phase 1 signature hero visual (Doc 03 section 41).
 *
 * Built from the brand's visual DNA (Doc 03 section 45): implied V geometry,
 * partial shield geometry, thin vector structures, controlled technical arcs,
 * sparse nodes, layered depth, subtle blue illumination and negative space.
 *
 * It is abstract and non-operational. It deliberately depicts no telemetry, no
 * map, no globe, no dashboard and no numbers, so it can never be mistaken for
 * fake operational evidence (Doc 03 sections 41, 47 and VIS-012).
 *
 * Decorative: aria-hidden, so it adds no screen-reader noise
 * (Doc 08 section 61). The hero's meaning lives entirely in its text.
 *
 * A2 delivers this as a reusable primitive. A4 places it in the Home hero.
 */
export default function SecurityField({ className = '', ...rest }) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Ambient motion is never started when the user asked for reduced motion.
  const drift = prefersReducedMotion ? '' : styles.drift;
  const driftReverse = prefersReducedMotion ? '' : styles.driftReverse;
  const pulse = prefersReducedMotion ? '' : styles.pulse;
  const pulseDelayed = prefersReducedMotion ? '' : styles.pulseDelayed;

  return (
    <div className={`${styles.wrap} ${className}`.trim()} aria-hidden="true" {...rest}>
      <svg
        className={styles.svg}
        viewBox="0 0 640 640"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        role="presentation"
      >
        <defs>
          <linearGradient id="vf-vector" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-bright)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="vf-shield" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="var(--color-silver)" stopOpacity="0.75" />
            <stop offset="70%" stopColor="var(--color-silver)" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* Layer 1 — sparse alignment grid. Desktop only. */}
        <g className={`${styles.grid} ${styles.detailOnly}`}>
          <path d="M320 96V544M96 320H544" />
          <path d="M188 150V490M452 150V490" opacity="0.6" />
        </g>

        {/* Layer 2 — technical arcs, slow counter-rotation for depth. */}
        <g className={`${styles.arc} ${driftReverse}`} strokeWidth="1">
          <path d="M320 108a212 212 0 0 1 212 212" />
          <path d="M320 532a212 212 0 0 1-212-212" />
          <path
            className={styles.detailOnly}
            d="M320 156a164 164 0 0 1 164 164"
            opacity="0.7"
          />
          <path
            className={styles.detailOnly}
            d="M320 484a164 164 0 0 1-164-164"
            opacity="0.7"
          />
        </g>

        {/* Layer 3 — partial shield. Open at the flanks: containment implied,
            never a closed padlock or a stock shield badge. */}
        <g className={`${styles.shield} ${drift}`} strokeWidth="1.25">
          <path
            d="M320 146 466 196v128c0 74-56 138-146 170"
            stroke="url(#vf-shield)"
          />
          <path
            d="M320 146 174 196v128c0 74 56 138 146 170"
            stroke="url(#vf-shield)"
            opacity="0.55"
          />
        </g>

        {/* Layer 4 — implied V. The brand mark's core geometry, drawn as two
            converging vectors rather than a literal letterform. */}
        <g className={styles.vector} strokeWidth="2.25">
          <path d="M236 236 320 420" stroke="url(#vf-vector)" />
          <path d="M404 236 320 420" stroke="url(#vf-vector)" />
          <path
            className={styles.detailOnly}
            d="M268 236 320 350M372 236 320 350"
            stroke="url(#vf-vector)"
            strokeWidth="1"
            opacity="0.45"
          />
        </g>

        {/* Layer 5 — sparse nodes at structural intersections only. */}
        <g>
          <circle className={`${styles.node} ${pulse}`} cx="320" cy="420" r="4.5" />
          <circle className={`${styles.node} ${pulseDelayed}`} cx="236" cy="236" r="3" />
          <circle className={`${styles.node} ${pulseDelayed}`} cx="404" cy="236" r="3" />
          <circle className={`${styles.nodeQuiet} ${styles.detailOnly}`} cx="320" cy="146" r="2.5" />
          <circle className={`${styles.nodeQuiet} ${styles.detailOnly}`} cx="466" cy="196" r="2" />
          <circle className={`${styles.nodeQuiet} ${styles.detailOnly}`} cx="174" cy="196" r="2" />
        </g>
      </svg>
    </div>
  );
}
