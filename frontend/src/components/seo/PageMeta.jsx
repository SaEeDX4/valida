import { useEffect } from 'react';
import { getSeoConfig } from '../../config/env.js';
import { HEAD_SELECTORS, describeHead, serializeJsonLd } from '../../seo/head.js';

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
 * C4 — what the head holds is decided by describeHead() (src/seo/head.js), the
 * SAME function the document server uses for the initial HTML
 * (frontend/server/). So a page loaded directly, refreshed or reached by
 * client navigation settles on identical metadata:
 *   title, description, robots           as before (A4-A6, C2);
 *   canonical (link rel="canonical")      indexable pages, canonical origin set;
 *   Open Graph (og:type, og:site_name,    the same pages;
 *     og:title, og:description, og:url)
 *   JobPosting JSON-LD                    an open Job Detail page only, and only
 *                                         when its inputs exist (src/seo/jobPosting.js;
 *                                         currently always withheld).
 * A non-indexed (review) build gives every page "noindex, nofollow" and none
 * of the canonical, Open Graph or JobPosting tags (Doc 16 section 82).
 *
 * OWNERSHIP MODEL
 * The route that is currently mounted owns every one of these tags. Each
 * effect below RECONCILES rather than only appending: given a value it creates
 * or reuses a single tag — including one the server already put in the
 * initial HTML — and given none it removes any tag left by a previous route.
 * So navigating away from an open Job removes its JobPosting (Doc 16 section
 * 125: JobPosting only on the individual Job Detail page).
 *
 * This is deliberately not done in an unmount cleanup. During an SPA
 * transition the incoming page can mount before the outgoing one finishes
 * cleaning up, so a cleanup-based removal would depend on effect ordering and
 * could delete the incoming page's tags. Reconciling from the mounted route
 * removes that timing dependency entirely: whichever route is on screen is the
 * one that decides.
 */
export default function PageMeta({ title, description, robots, path, jobPosting }) {
  const head = describeHead({ title, description, robots, path, jobPosting }, getSeoConfig());
  const openGraphKey = JSON.stringify(head.openGraph);
  const jsonLdText = head.jsonLd ? serializeJsonLd(head.jsonLd) : null;

  useEffect(() => {
    if (head.title) document.title = head.title;
  }, [head.title]);

  useEffect(() => {
    reconcileSingle(HEAD_SELECTORS.description, head.description, () => createMeta('name', 'description'), (tag, value) =>
      tag.setAttribute('content', value),
    );
  }, [head.description]);

  /*
   * Robots directive, owned by the mounted route exactly like the description.
   *
   * "noindex, follow" for Apply, a retained closed role, 404 and error states;
   * none for an indexable page — routes that pass nothing must have any
   * previous directive removed, or a stale noindex would silently suppress an
   * indexable page. In a review build: "noindex, nofollow" everywhere.
   */
  useEffect(() => {
    reconcileSingle(HEAD_SELECTORS.robots, head.robots, () => createMeta('name', 'robots'), (tag, value) =>
      tag.setAttribute('content', value),
    );
  }, [head.robots]);

  useEffect(() => {
    reconcileSingle(HEAD_SELECTORS.canonical, head.canonical, () => {
      const link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      return link;
    }, (tag, value) => tag.setAttribute('href', value));
  }, [head.canonical]);

  useEffect(() => {
    const wanted = new Map(JSON.parse(openGraphKey));
    const kept = new Set();
    for (const tag of [...document.querySelectorAll(HEAD_SELECTORS.openGraph)]) {
      const property = tag.getAttribute('property');
      if (!wanted.has(property) || kept.has(property)) {
        tag.remove();
        continue;
      }
      kept.add(property);
      tag.setAttribute('content', wanted.get(property));
    }
    for (const [property, content] of wanted) {
      if (kept.has(property)) continue;
      const tag = createMeta('property', property);
      tag.setAttribute('content', content);
      document.head.appendChild(tag);
    }
  }, [openGraphKey]);

  useEffect(() => {
    reconcileSingle(HEAD_SELECTORS.jsonLd, jsonLdText, () => {
      const script = document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      script.setAttribute('data-valida-structured-data', 'JobPosting');
      return script;
    }, (tag, value) => {
      if (tag.textContent !== value) tag.textContent = value;
    });
  }, [jsonLdText]);

  return null;
}

/** One tag per selector: removed when there is no value, otherwise collapsed to one and updated. */
function reconcileSingle(selector, value, create, update) {
  const existing = [...document.querySelectorAll(selector)];
  if (!value) {
    existing.forEach((tag) => tag.remove());
    return;
  }
  existing.slice(1).forEach((tag) => tag.remove());
  let tag = existing[0];
  if (!tag) {
    tag = create();
    document.head.appendChild(tag);
  }
  update(tag, value);
}

function createMeta(attribute, name) {
  const tag = document.createElement('meta');
  tag.setAttribute(attribute, name);
  return tag;
}
