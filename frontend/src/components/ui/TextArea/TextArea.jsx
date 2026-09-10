import styles from '../TextInput/TextInput.module.css';

/**
 * Multi-line text input.
 *
 * Shares TextInput's stylesheet deliberately: Doc 03 section 117 requires a
 * new component to reuse an existing visual primitive rather than invent a
 * second border, radius or focus treatment.
 */
export default function TextArea({ invalid = false, rows = 5, className = '', ...rest }) {
  const classes = [styles.input, styles.textarea, invalid ? styles.invalid : '', className]
    .filter(Boolean)
    .join(' ');
  return <textarea className={classes} rows={rows} {...rest} />;
}
