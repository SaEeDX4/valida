import { useCallback, useRef, useState } from 'react';
import { API_ERROR_TYPE } from '../../../services/api/apiClient.js';
import { getApplicationsService } from '../api/applicationsService.js';
import { createIdempotencyKey } from '../api/applicationsApi.js';
import mapServerFieldErrors from '../mapServerFieldErrors.js';

/** Mutually exclusive submission outcomes. */
export const SUBMIT_STATUS = {
  IDLE: 'idle',
  SUBMITTING: 'submitting',
  SUCCESS: 'success',
  FIELD_ERRORS: 'fieldErrors',
  JOB_CLOSED: 'jobClosed',
  JOB_UNAVAILABLE: 'jobUnavailable',
  RATE_LIMITED: 'rateLimited',
  FAILED: 'failed',
};

/**
 * Owns one logical application submission.
 *
 * SUCCESS DISCIPLINE — the single most important rule here.
 * SUBMIT_STATUS.SUCCESS is set in exactly one place: after the application
 * service resolves. Every rejection path sets a failure status. There is no
 * branch anywhere that turns a timeout, a network rejection, an HTTP error, a
 * missing backend or a fixture into success (Doc 06 sections 148, 153).
 *
 * IDEMPOTENCY LIFECYCLE (Doc 09 sections 74-80)
 * One logical submission gets one key, generated when the first attempt
 * begins and held in a ref. A retry of the SAME logical submission — the
 * candidate pressing "Try Again" after an uncertain transport failure — reuses
 * that key, so a request that actually reached the server cannot create a
 * second Application. The key is cleared only when the submission is no longer
 * the same logical one: after success, or after the candidate edits the form.
 * It never appears in the URL or in the UI.
 *
 * DUPLICATE SUBMISSION
 * A ref guard rejects re-entry while a request is in flight. This is stronger
 * than disabling the button alone, which a rapid double activation can beat.
 */
export default function useApplicationSubmission(jobSlug, { screeningQuestionIds = [] } = {}) {
  const [status, setStatus] = useState(SUBMIT_STATUS.IDLE);
  const [fieldErrors, setFieldErrors] = useState({});
  const idempotencyKeyRef = useRef(null);
  const inFlightRef = useRef(false);

  /**
   * Marks the current submission as logically finished, so the next attempt is
   * treated as a new submission and receives a new key.
   */
  const beginNewLogicalSubmission = useCallback(() => {
    idempotencyKeyRef.current = null;
  }, []);

  const submit = useCallback(
    async (formData) => {
      // Re-entry guard: a second activation while a request is open must not
      // create a second request.
      if (inFlightRef.current) return { ignored: true };
      inFlightRef.current = true;

      // Reuse the existing key when this is a retry of the same logical
      // submission; generate one only when starting a new one.
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = createIdempotencyKey();
      }

      setStatus(SUBMIT_STATUS.SUBMITTING);
      setFieldErrors({});

      try {
        const service = getApplicationsService();
        await service.submitApplication(jobSlug, formData, {
          idempotencyKey: idempotencyKeyRef.current,
        });

        // The ONLY path to success.
        idempotencyKeyRef.current = null;
        setStatus(SUBMIT_STATUS.SUCCESS);
        return { success: true };
      } catch (error) {
        const code = error?.code ?? null;
        const httpStatus = error?.status ?? null;

        if (code === 'JOB_NOT_ACCEPTING_APPLICATIONS') {
          /*
           * Selected by CODE, never by status alone. Doc 09 section 23 defines
           * more than one 409: IDEMPOTENCY_KEY_REUSED is also a 409, and telling
           * a candidate "applications have closed" when their key simply
           * conflicted would be a false statement about the role. Any 409 we do
           * not recognise falls through to the safe generic failure below.
           */
          setStatus(SUBMIT_STATUS.JOB_CLOSED);
        } else if (code === 'JOB_NOT_FOUND' || httpStatus === 404) {
          setStatus(SUBMIT_STATUS.JOB_UNAVAILABLE);
        } else if (code === 'IDEMPOTENCY_KEY_REUSED') {
          /*
           * Doc 09 section 80: the server rejected this key as conflicting, and
           * the client must generate a new one for a genuinely new submission.
           *
           * Clearing the ref is the whole point. Keeping it would make the
           * visible "Try Again" resend the same rejected key and fail with the
           * same 409 forever. The candidate's entered data is untouched — only
           * the key is invalidated.
           *
           * This is NOT a closed role, so it reports the generic failure.
           */
          idempotencyKeyRef.current = null;
          setStatus(SUBMIT_STATUS.FAILED);
        } else if (code === 'RATE_LIMITED' || httpStatus === 429) {
          setStatus(SUBMIT_STATUS.RATE_LIMITED);
        } else if (Array.isArray(error?.fieldErrors) && error.fieldErrors.length > 0) {
          /*
           * Server-side field validation maps onto the same field keys the
           * client uses, so errors land on the right controls AND the page can
           * raise the same canonical validation summary it uses for client
           * validation.
           *
           * The server's own message is deliberately NOT rendered: only the
           * canonical summary copy is shown, so arbitrary or internal server
           * text can never reach a candidate (Doc 08 section 121).
           */
          const mapped = mapServerFieldErrors(error.fieldErrors, { screeningQuestionIds });

          if (Object.keys(mapped).length === 0) {
            /*
             * Every path was unmappable. Attaching nothing while claiming
             * "review the highlighted fields" would send the candidate looking
             * for a highlight that does not exist, so this becomes a plain
             * failure instead.
             */
            setStatus(SUBMIT_STATUS.FAILED);
          } else {
            setFieldErrors(mapped);
            setStatus(SUBMIT_STATUS.FIELD_ERRORS);
          }
        } else if (error?.type === API_ERROR_TYPE.NETWORK) {
          setStatus(SUBMIT_STATUS.FAILED);
        } else {
          setStatus(SUBMIT_STATUS.FAILED);
        }

        return { success: false, error };
      } finally {
        inFlightRef.current = false;
      }
    },
    [jobSlug, screeningQuestionIds],
  );

  return {
    status,
    fieldErrors,
    submit,
    beginNewLogicalSubmission,
    isSubmitting: status === SUBMIT_STATUS.SUBMITTING,
  };
}
