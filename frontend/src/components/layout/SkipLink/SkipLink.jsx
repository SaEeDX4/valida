import styles from './SkipLink.module.css';

/**
 * SkipLink — Doc 08 section 28, Doc 05 section 178.
 *
 * Target is #main-content, the id every public layout exposes
 * (Doc 08 section 29). Copy is the canonical string from Document 06
 * section 10.
 */
export default function SkipLink({ targetId = 'main-content' }) {
  return (
    <a className={`t-button ${styles.skipLink}`} href={`#${targetId}`}>
      Skip to main content
    </a>
  );
}
