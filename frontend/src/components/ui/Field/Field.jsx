import { useId } from 'react';
import Icon from '../Icon/Icon.jsx';
import styles from './Field.module.css';

/**
 * Field — label, description and error wrapper for a single form control.
 *
 * Doc 08 sections 92-94 require a real <label> bound to the control by id.
 * This component generates the ids and hands them to the control through a
 * render prop, so no caller has to remember the aria wiring:
 *
 *   <Field label="Email" error={err}>
 *     {(props) => <TextInput type="email" {...props} />}
 *   </Field>
 *
 * Placeholder text is never the only label (Doc 03 section 59).
 * The error is announced via role="alert" and referenced by aria-describedby,
 * and the control receives aria-invalid, so the failure is communicated
 * structurally rather than by colour (Doc 03 section 62).
 */
export default function Field({
  label,
  description,
  error,
  required = false,
  optionalText,
  id,
  children,
  className = '',
}) {
  const generatedId = useId();
  const fieldId = id ?? `field-${generatedId}`;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  const controlProps = {
    id: fieldId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    required: required || undefined,
    invalid: Boolean(error),
  };

  return (
    <div className={`${styles.field} ${className}`.trim()}>
      <div className={styles.labelRow}>
        <label className="t-label" htmlFor={fieldId}>
          {label}
          {required ? (
            <>
              {' '}
              <span className={styles.required} aria-hidden="true">
                *
              </span>
              <span className="visually-hidden"> (required)</span>
            </>
          ) : null}
        </label>
        {!required && optionalText ? (
          <span className={`t-caption ${styles.optional}`}>{optionalText}</span>
        ) : null}
      </div>

      {description ? (
        <p id={descriptionId} className={`t-body-sm ${styles.description}`}>
          {description}
        </p>
      ) : null}

      {typeof children === 'function' ? children(controlProps) : children}

      {error ? (
        <p id={errorId} className={`t-body-sm ${styles.error}`} role="alert">
          <Icon name="alert" size="xs" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
