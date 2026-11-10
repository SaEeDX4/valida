import { useCallback, useEffect, useRef } from 'react';

/**
 * Keyboard continuity when the control a user just activated is replaced (C5).
 *
 * "Try Again" and "Submit Application" unmount themselves when their outcome
 * renders, and the browser then drops focus to <body>. The next Tab restarts
 * at the top of the document, and nothing that has focus describes the new
 * state. The outcome's heading is therefore marked data-focus-landing (with
 * tabIndex={-1}: focusable by script, not a Tab stop), and focus moves to it
 * once the outcome is on screen.
 *
 * Only in answer to the user's own action: an initial load never moves focus
 * (route changes are RouteChangeHandler's job). Nothing is announced twice:
 * the heading is read because it receives focus, and any polite status
 * message in the outcome carries different text.
 */
export const FOCUS_LANDING = { 'data-focus-landing': '', tabIndex: -1 };

export function focusLanding() {
  const target = document.querySelector('main [data-focus-landing]');
  if (target) target.focus();
  return target;
}

/**
 * Wraps a reload function. When the reload it started resolves (status leaves
 * `loadingStatus`), focus lands on the outcome's heading.
 */
export function useRetryFocus(status, reload, loadingStatus) {
  const pending = useRef(false);

  useEffect(() => {
    if (!pending.current || status === loadingStatus) return;
    pending.current = false;
    focusLanding();
  }, [status, loadingStatus]);

  return useCallback(() => {
    pending.current = true;
    reload();
  }, [reload]);
}

/** Moves focus to the outcome's heading when `outcome` is one that replaced the form. */
export function useOutcomeFocus(outcome, replacingOutcomes) {
  const replaces = replacingOutcomes.includes(outcome);
  useEffect(() => {
    if (replaces) focusLanding();
  }, [outcome, replaces]);
}
