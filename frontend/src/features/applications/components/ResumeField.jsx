import { useEffect, useId, useRef } from 'react';
import Button from '../../../components/ui/Button/Button.jsx';
import Icon from '../../../components/ui/Icon/Icon.jsx';
import { formatBytes, buildAcceptAttribute, buildResumeInstruction } from '../validation/resumeValidation.js';
import styles from './ResumeField.module.css';

/**
 * Resume selection control.
 *
 * A REAL <input type="file"> does the work and is the ONLY focus stop. It is
 * visually hidden but never removed, and the visible control is its <label>,
 * which carries the focus ring on its behalf via a :focus-visible sibling rule.
 * Earlier this component paired the hidden input with a separate button, which
 * produced two tab stops — one of them invisible. A keyboard user could land on
 * a focused control they could not see.
 *
 * Using a label rather than a scripted button also means the picker opens
 * through native behaviour, with no click() forwarding.
 *
 * CLAIM BOUNDARY (Doc 13, A5 security rule)
 * The messages here report only what a browser can determine: whether a file
 * was chosen, whether its extension is in the Job's configured list, and
 * whether its size is within the configured limit. Nothing states or implies
 * that the file is malware clean, structurally valid, content-verified or
 * stored, and no scanner or vendor detail is surfaced.
 *
 * Every constraint and the instruction text come from the Job's own
 * applicationForm.resume configuration, so the copy cannot drift from the
 * backend contract (Doc 06 section 121).
 */
export default function ResumeField({ resumeConfig, file, error, onSelect, onRemove, onInputId }) {
  const inputRef = useRef(null);
  const generatedId = useId();
  const inputId = `resume-${generatedId}`;
  const instructionId = `${inputId}-instruction`;
  const statusId = `${inputId}-status`;
  const errorId = `${inputId}-error`;

  /* Report the generated id so the validation summary can link to the real
     control rather than guessing at one. */
  useEffect(() => {
    onInputId?.(inputId);
  }, [inputId, onInputId]);

  const instruction = buildResumeInstruction(resumeConfig);
  const accept = buildAcceptAttribute(resumeConfig);
  const sizeLabel = file ? formatBytes(file.size) : null;

  /*
   * The error is referenced by the native input itself, so assistive technology
   * announces the problem with the control rather than leaving the message
   * floating elsewhere on the page.
   */
  const describedBy = [instruction ? instructionId : null, statusId, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.field}>
      {instruction ? (
        <p id={instructionId} className={`t-body-sm ${styles.instruction}`}>
          {instruction}
        </p>
      ) : null}

      <div className={styles.controls}>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.nativeInput}
          type="file"
          name="resume"
          /* accept is UX only: it filters the OS picker and is not validation. */
          accept={accept}
          required
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onSelect(event.target.files?.[0] ?? null)}
        />

        {/* The visible control IS the label for the input above. */}
        <label htmlFor={inputId} className={`t-button ${styles.pickerLabel}`}>
          <Icon name="upload" size="sm" />
          {file ? 'Replace File' : 'Choose File'}
          <span className="visually-hidden"> — Upload Resume (required)</span>
        </label>

        {file ? (
          <Button
            type="button"
            variant="ghost"
            size="standard"
            onClick={() => {
              // Clearing the native input matters: without it, re-selecting the
              // same file would not fire a change event.
              if (inputRef.current) inputRef.current.value = '';
              onRemove();
            }}
          >
            Remove
          </Button>
        ) : null}
      </div>

      {file ? (
        <div className={`${styles.selected} ${error ? styles.invalid : ''}`.trim()}>
          <span className={`t-body-sm ${styles.fileName}`}>Selected: {file.name}</span>
          {sizeLabel ? <span className={`t-caption ${styles.fileSize}`}>{sizeLabel}</span> : null}
        </div>
      ) : null}

      {/*
        Live region for the selection outcome. "Resume ready to submit" states
        only that the client-side checks passed — it makes no safety or storage
        claim.
      */}
      <p id={statusId} className="t-body-sm" role="status" aria-live="polite">
        {file && !error ? <span className={styles.ready}>Resume ready to submit.</span> : null}
      </p>

      {/* Owned by this component so the id the input points at always exists. */}
      {error ? (
        <p id={errorId} className={`t-body-sm ${styles.error}`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
