import { forwardRef } from 'react';
import Alert from '../../../components/ui/Alert/Alert.jsx';
import styles from './ValidationSummary.module.css';

/**
 * Validation summary shown after an invalid submit attempt.
 *
 * Focus is moved here by the Apply page so a keyboard or screen-reader user is
 * taken to the problem rather than left at the submit button. tabIndex={-1}
 * makes that possible without adding a permanent tab stop.
 *
 * Each invalid field is listed as an in-page link to its own control, so the
 * summary is a practical way to reach the problem and not just an announcement.
 * Errors are also attached to the individual fields, so nothing is communicated
 * by the summary alone — or by colour alone.
 */
const ValidationSummary = forwardRef(function ValidationSummary({ heading, body, items }, ref) {
  return (
    <div ref={ref} tabIndex={-1} className={styles.summary} data-testid="validation-summary">
      <Alert tone="error" title={heading}>
        <p>{body}</p>
        {items.length > 0 ? (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className={`t-body-sm ${styles.link}`}>
                  {item.message}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </Alert>
    </div>
  );
});

export default ValidationSummary;
