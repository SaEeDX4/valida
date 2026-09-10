import Alert from '../Alert/Alert.jsx';
import Button from '../Button/Button.jsx';

/**
 * ErrorState — a failed operation, with a retry affordance.
 *
 * Deliberately composed from Alert and Button rather than introducing new
 * visuals (Doc 03 section 117: reuse an existing primitive before inventing).
 *
 * CANONICAL COPY (06_CONTENT_COPY_DECK.md)
 * The defaults below are the GENERIC SYSTEM ERROR from Document 06 section 188
 * and the GENERIC RETRY LABEL from section 186, reproduced exactly. Document
 * 06 states the generic message is used "only when a more specific message is
 * not available", so callers are expected to pass the contextual copy their
 * surface defines, for example:
 *
 *   Careers list   -> "Open roles are temporarily unavailable." (Doc 06 s89)
 *   Job detail     -> "We couldn't load this role."             (Doc 06 s105)
 *   Home careers   -> "We couldn't load current roles."         (Doc 06 s48)
 *   Apply submit   -> "Your application wasn't submitted."      (Doc 06 s145)
 *
 * These props must never be used to invent new user-facing wording. Any string
 * shown to a visitor comes from Document 06.
 *
 * Doc 08 section 121 forbids surfacing error.stack, raw database errors or
 * storage exceptions to users, so this component accepts a message string and
 * never an error object.
 */
export default function ErrorState({
  title = 'Something went wrong.',
  message = 'We couldn’t complete this request. Please try again.',
  onRetry,
  retryLabel = 'Try Again',
  className = '',
  ...rest
}) {
  return (
    <Alert tone="error" title={title} className={className} {...rest}>
      <p>{message}</p>
      {onRetry ? (
        <p style={{ marginBlockStart: 'var(--space-3)' }}>
          <Button variant="secondary" size="compact" onClick={onRetry}>
            {retryLabel}
          </Button>
        </p>
      ) : null}
    </Alert>
  );
}
