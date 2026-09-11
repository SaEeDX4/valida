import { useParams } from 'react-router';
import RoutePlaceholder from './RoutePlaceholder.jsx';

/**
 * Job Detail route, /careers/:jobSlug.
 *
 * The slug is read to prove the dynamic segment resolves. It is rendered as
 * plain text inside React, which escapes it, and it is never used to assert
 * that a job with that slug exists — job existence and the not-found case are
 * decided by the API in B3 (Doc 04 section 31, Doc 08 section 86).
 */
export default function JobDetailPage() {
  const { jobSlug } = useParams();

  return (
    <RoutePlaceholder title="Careers at Valida" heading="Job Detail" milestone="A5">
      <p className="t-metadata">
        Route parameter received: <code className="t-mono">{jobSlug}</code>
      </p>
    </RoutePlaceholder>
  );
}
