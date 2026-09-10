import styles from './LoadingSkeleton.module.css';

/**
 * LoadingSkeleton — a placeholder that roughly matches the shape of the
 * content it replaces (Doc 03 section 104).
 *
 * The wrapper carries the accessible announcement once; the individual bars
 * are decorative, so a five-line skeleton does not announce five times.
 *
 * COPY (06_CONTENT_COPY_DECK.md section 185)
 * Document 06 defines loading messages contextually, not generically:
 *   Careers          -> "Loading open roles…"
 *   Job detail       -> "Loading role details…"
 *   Form submission  -> "Submitting…"
 *   File             -> "Checking file…"
 * and warns against uncontextualised waiting text. Consuming surfaces must
 * therefore pass the `label` their context defines. The bare default below is
 * the minimal accessible fallback so the live region is never empty; it is a
 * state word, not user-facing marketing copy, and Document 06 defines no
 * generic loading string to use in its place.
 */
export default function LoadingSkeleton({
  lines = 3,
  height = 'var(--space-5)',
  label = 'Loading',
  className = '',
  ...rest
}) {
  return (
    <div
      className={`${styles.stack} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
      {...rest}
    >
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className={styles.skeleton}
          aria-hidden="true"
          style={{
            height,
            // Vary the final bar so the block reads as text, not a table.
            width: index === lines - 1 ? '62%' : '100%',
          }}
        />
      ))}
    </div>
  );
}
