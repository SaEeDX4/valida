import { Link } from 'react-router';
import Icon from '../../../components/ui/Icon/Icon.jsx';
import { jobRoute } from '../../../routes/paths.js';
import resolveJobMarketPresentation, {
  buildRegionalRowFacts,
} from '../utils/resolveJobMarketPresentation.js';
import styles from './JobRow.module.css';

/**
 * One published role in the Careers list.
 *
 * Renders ONLY values the API actually supplied (Doc 06 section 87). A missing
 * location, arrangement, employment type, hours or compensation is simply
 * omitted — no placeholder, no "not specified", nothing invented.
 *
 * The row is a single real <Link>, never a clickable div. Its accessible name
 * is "View Role: {job.title}" (OD-2026-11-10-01): it starts with the visible
 * call to action, so a speech-input user can say what they see (WCAG 2.5.3),
 * and it names the role, so a screen-reader user hearing a list of links can
 * tell the roles apart. The metadata inside is plain text and is not
 * separately focusable.
 */
export default function JobRow({ job, region, toJobHref = jobRoute }) {
  /*
   * The same resolver Job Detail and Apply use, so a role's location and
   * compensation cannot read differently on the list than on its own page.
   * Employment type still appears only when the Job explicitly supplies one.
   */
  const facts = buildRegionalRowFacts(resolveJobMarketPresentation(job, region));

  return (
    <li className={styles.item}>
      <Link
        to={toJobHref(job.slug)}
        className={styles.link}
        aria-label={`View Role: ${job.title}`}
      >
        <div>
          <h3 className={`t-h4 ${styles.title}`}>{job.title}</h3>
          {facts.length > 0 ? (
            <ul className={`t-body-sm ${styles.facts}`}>
              {facts.map((fact) => (
                <li key={fact} className={styles.fact}>
                  {fact}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <span className={`t-button ${styles.action}`} aria-hidden="true">
          View Role
          <Icon name="arrowRight" size="sm" />
        </span>
      </Link>
    </li>
  );
}
