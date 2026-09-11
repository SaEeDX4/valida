import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * Scroll and focus behaviour on SPA route change.
 *
 * Doc 08 section 158 — scroll restoration: a new page navigation goes to the
 * top of the page, while browser Back/Forward keeps the position the browser
 * restores. So this only scrolls on PUSH/REPLACE, never on POP.
 *
 * Doc 08 section 160 and Doc 05 section 177 — focus must not be left stranded
 * in the previous page's navigation context. On route change focus moves to
 * the main landmark, so the next Tab continues into the new page rather than
 * resuming inside the header. Because #main-content carries tabIndex={-1},
 * this is programmatic focus only and does not add a tab stop.
 *
 * The initial render is skipped deliberately: stealing focus on first paint
 * would fight the browser's own restoration and disorient a user who landed
 * via a direct URL.
 *
 * Reduced motion is respected — scrolling is instant rather than smooth when
 * the user has asked for reduced motion (Doc 03 section 77).
 */
export default function RouteChangeHandler() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const isInitialRender = useRef(true);

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }

    if (navigationType !== 'POP') {
      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      window.scrollTo({ top: 0, left: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    }

    document.getElementById('main-content')?.focus();
  }, [pathname, navigationType]);

  return null;
}
