import Icon from '../Icon/Icon.jsx';
import styles from './Alert.module.css';

const TONES = {
  info: { box: styles.info, icon: styles.iconInfo, glyph: 'info', label: 'Information' },
  success: { box: styles.success, icon: styles.iconSuccess, glyph: 'check', label: 'Success' },
  warning: { box: styles.warning, icon: styles.iconWarning, glyph: 'alert', label: 'Warning' },
  error: { box: styles.error, icon: styles.iconError, glyph: 'alert', label: 'Error' },
};

/**
 * Alert — a persistent, non-dismissing message block.
 *
 * Each tone pairs a colour with a distinct icon and a visually hidden text
 * label, so meaning never depends on colour alone (Doc 03 section 62 and
 * WCAG 2.2 use-of-colour).
 *
 * Error and warning tones announce assertively; info and success announce
 * politely, so a routine confirmation never interrupts a screen reader
 * mid-sentence.
 *
 * The tone labels ("Information", "Success", ...) are visually hidden strings
 * for assistive technology, not user-facing copy from Document 06. All visible
 * text is supplied by the calling surface from Document 06.
 */
export default function Alert({ tone = 'info', title, children, className = '', ...rest }) {
  const config = TONES[tone] ?? TONES.info;
  const assertive = tone === 'error' || tone === 'warning';

  return (
    <div
      className={`${styles.alert} ${config.box} ${className}`.trim()}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      {...rest}
    >
      <Icon name={config.glyph} size="md" className={config.icon} />
      <div className={styles.content}>
        <span className="visually-hidden">{config.label}: </span>
        {title ? <p className={`t-label ${styles.title}`}>{title}</p> : null}
        <div className={`t-body-sm ${styles.body}`}>{children}</div>
      </div>
    </div>
  );
}
