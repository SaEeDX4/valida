import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { resolveVisitorRegion, INTERNATIONAL_REGION } from '../markets.js';

/**
 * The visitor's active regional view, held in the URL.
 *
 * The URL is deliberately the only home for this. It survives navigation and
 * refresh, it can be shared, and it keeps the selection out of localStorage and
 * sessionStorage entirely — applicant-adjacent state is never persisted to the
 * browser (Doc 13).
 *
 * `withRegion` appends the active region to an in-app path so Careers →
 * Job Detail → Apply → Back to Role all keep the same view. It only does so
 * when the visitor actually chose a region: an inferred locale default is not
 * written into every link, which would make an inference look like a decision.
 */
export default function useActiveRegion() {
  const [searchParams, setSearchParams] = useSearchParams();
  const regionParam = searchParams.get('region');

  const region = useMemo(
    () =>
      resolveVisitorRegion({
        regionParam,
        locales:
          typeof navigator !== 'undefined' && Array.isArray(navigator.languages)
            ? navigator.languages
            : [typeof navigator !== 'undefined' ? navigator.language : ''].filter(Boolean),
      }),
    [regionParam],
  );

  const setRegion = useCallback(
    (nextRegion) => {
      const next = new URLSearchParams(searchParams);
      if (!nextRegion || nextRegion === INTERNATIONAL_REGION) next.set('region', INTERNATIONAL_REGION);
      else next.set('region', nextRegion);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  const withRegion = useCallback(
    (path) => (regionParam ? `${path}${path.includes('?') ? '&' : '?'}region=${encodeURIComponent(region)}` : path),
    [region, regionParam],
  );

  return { region, setRegion, withRegion, isExplicit: Boolean(regionParam) };
}
