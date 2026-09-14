import Field from '../../../components/ui/Field/Field.jsx';
import TextInput from '../../../components/ui/TextInput/TextInput.jsx';
import TextArea from '../../../components/ui/TextArea/TextArea.jsx';
import {
  isSupportedScreeningType,
  maxLengthForQuestion,
} from '../screeningContract.js';
import styles from './ScreeningQuestions.module.css';

/**
 * Screening questions, rendered strictly from real Job configuration.
 *
 * Doc 09 section 67 supports exactly four Phase 1 types. Anything else is
 * ignored rather than guessed at — this is deliberately not a generalised
 * form-builder engine.
 *
 * Each control's id derives from the question's own stable identifier, not
 * from its array index, so reordering the configuration cannot silently
 * reassign a candidate's answer to a different question.
 *
 * YES_NO holds a BOOLEAN. "Yes" and "No" are labels shown to the candidate;
 * the logical value stored in state and serialised to the server is true/false.
 * Keeping label and value separate means changing the wording can never change
 * what is transmitted.
 *
 * SINGLE_SELECT renders a native <select> restricted to the supplied options;
 * YES_NO renders a radio group in a fieldset so the pair is announced as one
 * question. Client state never accepts a value outside the configuration, and
 * the backend still re-validates.
 */
/** Canonical YES_NO options: visible label paired with its logical value. */
const YES_NO_OPTIONS = [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
];

export default function ScreeningQuestions({ questions, values, errors, onChange }) {
  const usable = (Array.isArray(questions) ? questions : []).filter(
    (question) => question && typeof question.id === 'string' && isSupportedScreeningType(question.type),
  );

  if (usable.length === 0) return null;

  return (
    <>
      {usable.map((question) => {
        const fieldKey = `screening:${question.id}`;
        const value = values?.[question.id];
        const error = errors?.[fieldKey];
        const controlId = `screening-${question.id}`;

        if (question.type === 'YES_NO') {
          const errorId = error ? `${controlId}-error` : undefined;
          return (
            <fieldset key={question.id} className={styles.group}>
              <legend className={`t-label ${styles.legend}`}>
                {question.prompt}
                {question.required ? (
                  <>
                    {' '}
                    <span className={styles.required} aria-hidden="true">*</span>
                    <span className="visually-hidden"> (required)</span>
                  </>
                ) : null}
              </legend>
              <div
                role="radiogroup"
                /*
                 * The asterisk and the visually hidden "(required)" are visual
                 * and textual cues; aria-required is what actually tells
                 * assistive technology the group must be answered. Applied only
                 * when the question really is required, so an optional question
                 * never announces one.
                 */
                aria-required={question.required ? true : undefined}
                aria-describedby={errorId}
                aria-invalid={error ? true : undefined}
                className={styles.options}
              >
                {YES_NO_OPTIONS.map((option) => (
                  <label key={option.label} className={`t-body ${styles.option}`}>
                    <input
                      type="radio"
                      name={controlId}
                      // The DOM value is a string; the logical value passed up
                      // to state is the boolean.
                      value={String(option.value)}
                      checked={value === option.value}
                      onChange={() => onChange(question.id, option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {error ? (
                <p id={errorId} className={`t-body-sm ${styles.error}`} role="alert">
                  {error}
                </p>
              ) : null}
            </fieldset>
          );
        }

        const textValue = typeof value === 'string' ? value : '';

        return (
          <Field
            key={question.id}
            id={controlId}
            label={question.prompt}
            required={Boolean(question.required)}
            error={error}
          >
            {(props) => {
              if (question.type === 'LONG_TEXT') {
                return (
                  <TextArea
                    {...props}
                    maxLength={maxLengthForQuestion(question) ?? undefined}
                    value={textValue}
                    onChange={(event) => onChange(question.id, event.target.value)}
                  />
                );
              }
              if (question.type === 'SINGLE_SELECT') {
                const options = (Array.isArray(question.options) ? question.options : []).filter(
                  (option) => option && typeof option.optionId === 'string',
                );
                const { invalid, ...selectProps } = props;
                return (
                  <select
                    {...selectProps}
                    className={`${styles.select} ${invalid ? styles.selectInvalid : ''}`.trim()}
                    value={textValue}
                    onChange={(event) => onChange(question.id, event.target.value)}
                  >
                    <option value="">Select an option</option>
                    {options.map((option) => (
                      // value is the stable identifier; the label is display
                      // text only and is never what gets submitted.
                      <option key={option.optionId} value={option.optionId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                );
              }
              return (
                <TextInput
                  {...props}
                  maxLength={maxLengthForQuestion(question) ?? undefined}
                  value={textValue}
                  onChange={(event) => onChange(question.id, event.target.value)}
                />
              );
            }}
          </Field>
        );
      })}
    </>
  );
}
