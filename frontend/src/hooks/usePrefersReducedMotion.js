import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Reports the user's reduced-motion preference.
 *
 * Doc 03 section 77 and Doc 08 section 65 require reduced motion to be
 * respected. Global CSS already handles declarative animation; this hook
 * covers the cases CSS cannot reach — where a component must not *start*
 * JavaScript-driven ambient motion at all (the Security Field).
 *
 * Defaults to "reduced" until measured, so ambient motion never runs for a
 * frame before the preference is known.
 */
export default function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setPrefersReducedMotion(false);
      return undefined;
    }

    const mediaQuery = window.matchMedia(QUERY);
    setPrefersReducedMotion(mediaQuery.matches);

    const onChange = (event) => setPrefersReducedMotion(event.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange);
      return () => mediaQuery.removeEventListener('change', onChange);
    }

    // Older Safari
    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  return prefersReducedMotion;
}
