import styles from './TextInput.module.css';

/**
 * Single-line text input.
 *
 * Doc 08 section 91 — native HTML first. This is a thin styled wrapper around
 * <input>; it forwards every native attribute (type, autocomplete, inputMode,
 * maxLength) so callers keep full native behaviour and browser autofill.
 *
 * `invalid` is supplied by Field and only drives the border treatment; the
 * accessible error wiring lives in Field.
 */
export default function TextInput({ invalid = false, className = '', ...rest }) {
  const classes = [styles.input, invalid ? styles.invalid : '', className]
    .filter(Boolean)
    .join(' ');
  return <input className={classes} {...rest} />;
}
