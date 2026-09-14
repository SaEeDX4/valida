import { useCallback, useEffect, useRef, useState } from 'react';

/** Mutually exclusive request states. */
export const RESOURCE_STATUS = {
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
};

/**
 * Loads one asynchronous resource and exposes its state.
 *
 * The states are mutually exclusive on purpose. A failure can only ever
 * produce `error`, never `success` with empty data — which is what keeps a
 * 503 from rendering the Careers empty state (Doc 09 section 57).
 *
 * `reload` issues a genuinely new request. It is caller-driven only: there is
 * no automatic retry and no backoff loop, so a failing API cannot generate
 * uncontrolled traffic.
 *
 * In-flight requests are aborted on unmount and superseded on reload, so a
 * late response from an abandoned request can never overwrite newer state.
 */
export default function useAsyncResource(loader, deps = []) {
  const [state, setState] = useState({ status: RESOURCE_STATUS.LOADING, data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef(null);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    let active = true;

    setState({ status: RESOURCE_STATUS.LOADING, data: null, error: null });

    loader({ signal: controller.signal })
      .then((data) => {
        if (active && !controller.signal.aborted) {
          setState({ status: RESOURCE_STATUS.SUCCESS, data, error: null });
        }
      })
      .catch((error) => {
        if (active && !controller.signal.aborted) {
          setState({ status: RESOURCE_STATUS.ERROR, data: null, error });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { ...state, reload };
}
