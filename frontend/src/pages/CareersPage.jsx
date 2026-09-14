import { useCallback } from 'react';
import { Link } from 'react-router';
import Container from '../components/layout/Container/Container.jsx';
import Section, { SectionEyebrow, SectionHeader } from '../components/layout/Section/Section.jsx';
import Button from '../components/ui/Button/Button.jsx';
import TextLink from '../components/ui/TextLink/TextLink.jsx';
import LoadingSkeleton from '../components/ui/LoadingSkeleton/LoadingSkeleton.jsx';
import EmptyState from '../components/ui/EmptyState/EmptyState.jsx';
import ErrorState from '../components/ui/ErrorState/ErrorState.jsx';
import StatusMessage from '../components/ui/StatusMessage/StatusMessage.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';
import JobRow from '../features/jobs/components/JobRow.jsx';
import RegionSelector from '../features/jobs/components/RegionSelector.jsx';
import useActiveRegion from '../features/jobs/hooks/useActiveRegion.js';
import { getJobsService } from '../features/jobs/api/jobsService.js';
import useAsyncResource, { RESOURCE_STATUS } from '../features/jobs/hooks/useAsyncResource.js';
import { ROUTES, jobRoute } from '../routes/paths.js';
import {
  CAREERS_META, CAREERS_HERO, WORK_CONTEXT, OPEN_ROLES, RECRUITMENT_PROCESS, PRIVACY_NOTE,
} from './CareersPage.content.js';
import styles from './CareersPage.module.css';

/**
 * Careers — Doc 18 section 68, Doc 05 sections 74-84, Doc 06 sections 77-93.
 *
 * Composition: hero, work context, open roles (loading / list / empty / error),
 * recruitment process, privacy context.
 *
 * DATA TRUTH
 * Role data comes exclusively from the Jobs service. The four states are
 * mutually exclusive and derived from the real request outcome:
 *   - loading  : request in flight
 *   - list     : successful response with items
 *   - empty    : successful response with items: []  ← the ONLY empty condition
 *   - error    : any failure, including 503, network loss and malformed payload
 *
 * A failure is never shown as "no open roles" (Doc 09 section 57), and no Job
 * value is embedded in this component. Before Release B exists, a real browser
 * will legitimately show the error state — that is the honest outcome, not a
 * reason to substitute fixtures.
 */
export default function CareersPage() {
  const { region, setRegion, withRegion } = useActiveRegion();
  const loadJobs = useCallback(({ signal }) => getJobsService().getPublishedJobs({ signal }), []);
  const { status, data, reload } = useAsyncResource(loadJobs);

  const jobs = status === RESOURCE_STATUS.SUCCESS && Array.isArray(data?.items) ? data.items : [];

  return (
    <>
      <PageMeta title={CAREERS_META.title} description={CAREERS_META.description} />

      <section className={styles.hero} aria-labelledby="careers-hero-heading">
        <Container width="wide">
          <div className={styles.heroInner}>
            <p className="t-eyebrow">{CAREERS_HERO.eyebrow}</p>
            <h1 id="careers-hero-heading" className="t-h1">{CAREERS_HERO.heading}</h1>
            <span className={styles.heroRule} aria-hidden="true" />
            <p className={`t-body-lg ${styles.heroBody}`}>{CAREERS_HERO.body}</p>
          </div>
        </Container>
      </section>

      <Section spacing="lg" aria-labelledby="careers-context-heading">
        <Container width="wide">
          <div className={styles.contextGrid}>
            <div>
              <SectionEyebrow>{WORK_CONTEXT.eyebrow}</SectionEyebrow>
              <h2 id="careers-context-heading" className="t-h2">
                {WORK_CONTEXT.heading}
              </h2>
            </div>
            <div className={styles.contextBody}>
              {WORK_CONTEXT.paragraphs.map((paragraph) => (
                <p key={paragraph} className={`t-body-lg ${styles.contextParagraph}`}>{paragraph}</p>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section spacing="lg" surface="secondary" aria-labelledby="careers-roles-heading">
        <Container width="wide">
          <div className={styles.rolesHeader}>
            <h2 id="careers-roles-heading" className="t-h2">{OPEN_ROLES.heading}</h2>
            <p className={`t-body-lg ${styles.rolesIntro}`}>{OPEN_ROLES.intro}</p>
          </div>

          {/*
            One compact regional control for the whole list, rather than a badge
            repeated on every row, which would be noise at list density.
          */}
          <RegionSelector region={region} onChange={setRegion} standalone />

          {status === RESOURCE_STATUS.LOADING ? (
            <div data-testid="careers-loading">
              {/* Announced once; the placeholder bars carry no fake titles. */}
              <StatusMessage visible={false}>{OPEN_ROLES.loadingStatus}</StatusMessage>
              <div className={styles.skeletonList} aria-hidden="true">
                {[0, 1, 2].map((index) => (
                  <div key={index} className={styles.skeletonRow}>
                    {/*
                      label="" on purpose: the StatusMessage above already
                      announces loading once. Letting each skeleton carry its
                      own label would repeat the same status four times.
                    */}
                    <LoadingSkeleton lines={2} label="" />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {status === RESOURCE_STATUS.SUCCESS && jobs.length > 0 ? (
            <ul className={styles.roleList} data-testid="careers-job-list">
              {jobs.map((job) => (
                <JobRow
                  key={job.slug}
                  job={job}
                  region={region}
                  // Carries the active view through to Job Detail.
                  toJobHref={(slug) => withRegion(jobRoute(slug))}
                />
              ))}
            </ul>
          ) : null}

          {status === RESOURCE_STATUS.SUCCESS && jobs.length === 0 ? (
            <div className={styles.stateBlock} data-testid="careers-empty">
              <EmptyState title={OPEN_ROLES.empty.heading}>{OPEN_ROLES.empty.body}</EmptyState>
            </div>
          ) : null}

          {status === RESOURCE_STATUS.ERROR ? (
            <div className={styles.stateBlock} data-testid="careers-error">
              {/* Retry issues a genuinely new request; there is no automatic loop. */}
              <ErrorState
                title={OPEN_ROLES.error.heading}
                message={OPEN_ROLES.error.body}
                retryLabel={OPEN_ROLES.error.retry}
                onRetry={reload}
              />
            </div>
          ) : null}
        </Container>
      </Section>

      <Section spacing="lg" aria-labelledby="careers-process-heading">
        <Container width="wide">
          <div className={styles.processGrid}>
            <h2 id="careers-process-heading" className="t-h2">{RECRUITMENT_PROCESS.heading}</h2>
            <div className={styles.contextBody}>
              {RECRUITMENT_PROCESS.paragraphs.map((paragraph) => (
                <p key={paragraph} className={`t-body-lg ${styles.contextParagraph}`}>{paragraph}</p>
              ))}
            </div>
          </div>

          <p className={`t-body-sm ${styles.privacyNote}`}>
            <span>{PRIVACY_NOTE.text}</span>
            <TextLink as={Link} to={ROUTES.PRIVACY}>{PRIVACY_NOTE.linkLabel}</TextLink>
          </p>
        </Container>
      </Section>
    </>
  );
}
