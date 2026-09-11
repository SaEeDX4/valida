import { useEffect } from 'react';

/**
 * Sets the document title for a route.
 *
 * Doc 05 section 20 requires public route changes to update the document
 * title. Titles come from Document 06 and are passed by each page; this
 * component invents no copy.
 *
 * A3 deliberately handles the title only. Descriptions, canonical URLs and
 * Open Graph tags are page-content concerns owned by A4 (Doc 08 sections
 * 126-132), and the production domain they need is still AWAITING INPUT.
 */
export default function PageMeta({ title }) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  return null;
}
