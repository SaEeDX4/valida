import styles from './EmptyState.module.css';

/**
 * EmptyState — shown when a real data system returns no records.
 *
 * Doc 00 BUILD-006: empty data requires a correct empty state; it never
 * justifies removing the underlying system. This component is what "no open
 * roles" looks like on Careers once the real Jobs API is connected in C1.
 */
export default function EmptyState({ title, children, action, className = '', ...rest }) {
  return (
    <div className={`${styles.empty} ${className}`.trim()} {...rest}>
      <p className={`t-h4 ${styles.title}`}>{title}</p>
      {children ? <div className={`t-body ${styles.body}`}>{children}</div> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
