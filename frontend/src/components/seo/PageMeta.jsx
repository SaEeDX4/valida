import { useEffect } from 'react';

/** Every route renders exactly one PageMeta, so this selector is unambiguous. */
const DESCRIPTION_SELECTOR = 'meta[name="description"]';
const ROBOTS_SELECTOR = 'meta[name="robots"]';

/**
 * Sets per-route document metadata.
 *
 * Doc 05 section 20 requires public route changes to update the document
 * title; Doc 08 sections 126-132 add the description. All values come from
 * Document 06 and are passed in by each page — this component invents no copy.
 *
 * Centralised on purpose (Doc 08 section 126): pages never touch document.head
 * directly, so head handling has exactly one owner.
 *
 * OWNERSHIP MODEL
 * The route that is currently mounted owns the description. The effect below
 * therefore RECONCILES rather than only appending: given a description it
 * creates or reuses a single tag, and given none it removes any tag left by a
 * previous route.
 *
 * This is deliberately not done in an unmount cleanup. During an SPA
 * transition the incoming page can mount before the outgoing one finishes
 * cleaning up, so a cleanup-based removal would depend on effect ordering and
 * could delete the incoming page's description. Reconciling from the mounted
 * route removes that timing dependency entirely: whichever route is on screen
 * is the one that decides.
 *
 * Without this, navigating from a page that has a description (Home) to one
 * that does not (404, or the Careers placeholder) left the previous page's
 * description attached to the new page.
 *
 * DELIBERATELY NOT IMPLEMENTED IN A4
 * Canonical URL, og:url and og:image need the production hostname and an
 * approved social asset. Neither exists yet (Document 14 — AWAITING INPUT), so
 * fabricating a domain here would publish a URL that does not resolve. The
 * signature is ready for A6/Release C to add them once the host is chosen.
 */
export default function PageMeta({ title, description, robots }) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  useEffect(() => {
    const existing = [...document.querySelectorAll(DESCRIPTION_SELECTOR)];

    if (!description) {
      // This route publishes no description, so no description may remain.
      existing.forEach((tag) => tag.remove());
      return;
    }

    // Collapse any duplicates to a single authoritative tag before writing.
    existing.slice(1).forEach((tag) => tag.remove());

    let tag = existing[0];
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'description');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', description);
  }, [description]);

  /*
   * Robots directive, owned by the mounted route exactly like the description.
   *
   * A5 needs "noindex, follow" for Apply — an application form has no search
   * value and must not be indexed — and for a retained closed role, which stays
   * reachable at its stable URL but is no longer an opportunity. Routes that
   * pass nothing must have any previous directive removed, or a stale noindex
   * would silently suppress an indexable page.
   *
   * This is the narrow extension A5 requires for state correctness. Full
   * production SEO infrastructure remains Release C4.
   */
  useEffect(() => {
    const existing = [...document.querySelectorAll(ROBOTS_SELECTOR)];
    if (!robots) {
      existing.forEach((tag) => tag.remove());
      return;
    }
    existing.slice(1).forEach((tag) => tag.remove());
    let tag = existing[0];
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'robots');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', robots);
  }, [robots]);

  return null;
}
