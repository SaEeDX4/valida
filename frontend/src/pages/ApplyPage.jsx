import { useParams } from 'react-router';
import RoutePlaceholder from './RoutePlaceholder.jsx';

/**
 * Apply route, /careers/:jobSlug/apply.
 *
 * No form, no upload and no submission exist here. The application workflow is
 * A5 presentation and B5 submission. Nothing on this page may suggest that an
 * application can currently be sent.
 */
export default function ApplyPage() {
  const { jobSlug } = useParams();

  return (
    <RoutePlaceholder title="Apply | Valida" heading="Apply" milestone="A5">
      <p className="t-metadata">
        Route parameter received: <code className="t-mono">{jobSlug}</code>
      </p>
    </RoutePlaceholder>
  );
}
