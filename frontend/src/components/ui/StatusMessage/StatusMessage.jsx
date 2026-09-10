/**
 * StatusMessage — a live region for transient status text.
 *
 * Distinct from Alert: Alert is a visible message block, StatusMessage is the
 * announcement channel. It renders an always-present live region so that
 * later-injected text is reliably announced; a region created at the same
 * moment as its content is often missed by screen readers.
 *
 * Used in A5 for submit progress and validation summaries.
 */
export default function StatusMessage({
  children,
  assertive = false,
  visible = true,
  className = '',
  ...rest
}) {
  return (
    <p
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={[visible ? 't-body-sm' : 'visually-hidden', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </p>
  );
}
