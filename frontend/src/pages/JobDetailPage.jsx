import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import Container from '../components/layout/Container/Container.jsx';
import Section from '../components/layout/Section/Section.jsx';
import Button from '../components/ui/Button/Button.jsx';
import TextLink from '../components/ui/TextLink/TextLink.jsx';
import Surface from '../components/ui/Surface/Surface.jsx';
import LoadingSkeleton from '../components/ui/LoadingSkeleton/LoadingSkeleton.jsx';
import StatusMessage from '../components/ui/StatusMessage/StatusMessage.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';
import { getJobsService } from '../features/jobs/api/jobsService.js';
import useAsyncResource, { RESOURCE_STATUS } from '../features/jobs/hooks/useAsyncResource.js';
import { isJobOpen, isJobClosed, toContentList } from '../features/jobs/utils/formatJob.js';
import resolveJobMarketPresentation, {
  buildRegionalJobFacts,
} from '../features/jobs/utils/resolveJobMarketPresentation.js';
import RegionSelector from '../features/jobs/components/RegionSelector.jsx';
import useActiveRegion from '../features/jobs/hooks/useActiveRegion.js';
import { ROUTES, applyRoute } from '../routes/paths.js';
import { JOB_DETAIL, jobDetailTitle, jobDetailDescription } from './JobDetailPage.content.js';
import styles from './JobDetailPage.module.css';

/**
 * Job Detail — Doc 18 section 69, Doc 05 sections 85-96, Doc 06 sections 94-106.
 *
 * States: loading, open, closed, unavailable, error — mutually exclusive and
 * derived from the real service outcome.
 *
 * PUBLIC-SAFETY RULES
 * - Job data comes only from getPublishedJobBySlug. Nothing is read from local
 *   page data and no publication decision is made in the client.
 * - A 404 becomes the neutral "unavailable" state. Draft, Archived and unknown
 *   are indistinguishable here by design (Doc 09 section 46) — the UI never
 *   learns, or reveals, which one it was.
 * - A service failure is NEVER mapped to "not found": a 503 shows the error
 *   state with retry, so a transient outage cannot imply the role was removed.
 * - A closed Job renders its content but carries no Apply CTA and no route to
 *   the Apply form (Doc 09 section 65).
 * - Sections render only when their data actually exists; an empty
 *   preferredQualifications array produces no heading at all.
 */
export default function JobDetailPage() {
  const { jobSlug } = useParams();
  const { region, setRegion, withRegion } = useActiveRegion();

  const loadJob = useCallback(
    ({ signal }) => getJobsService().getPublishedJobBySlug(jobSlug, { signal }),
    [jobSlug],
  );
  const { status, data, error, reload } = useAsyncResource(loadJob, [jobSlug]);
  const job = data?.job ?? null;

  const breadcrumbs = (currentLabel) => (
    <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
      <ol className={`t-body-sm ${styles.crumbList}`}>
        <li>
          <TextLink as={Link} to={withRegion(ROUTES.CAREERS)} variant="quiet">
            {JOB_DETAIL.breadcrumbRoot}
          </TextLink>
        </li>
        <li className={styles.crumbSep} aria-hidden="true">/</li>
        <li aria-current="page">{currentLabel}</li>
      </ol>
    </nav>
  );

  if (status === RESOURCE_STATUS.LOADING) {
    return (
      <>
        <PageMeta title="Careers at Valida" />
        <Section spacing="lg">
          <Container width="wide">
            <StatusMessage visible={false}>{JOB_DETAIL.loadingStatus}</StatusMessage>
            {/* Structural skeleton only — no fake title, salary or responsibilities. */}
            <div aria-hidden="true" data-testid="job-loading">
              <LoadingSkeleton lines={2} height="var(--space-8)" label="" />
              <div className={styles.skeletonGap} />
              <LoadingSkeleton lines={6} label="" />
            </div>
          </Container>
        </Section>
      </>
    );
  }

  // 404 and any other "not public" outcome share one neutral state.
  if (status === RESOURCE_STATUS.ERROR && (error?.status === 404 || error?.code === 'JOB_NOT_FOUND')) {
    return (
      <>
        <PageMeta title="Page Not Found | Valida" robots="noindex, follow" />
        <Section spacing="lg">
          <Container width="wide">
            <div className={styles.stateBlock} data-testid="job-unavailable">
              <h1 className="t-h2">{JOB_DETAIL.notFound.heading}</h1>
              <p className="t-body-lg">{JOB_DETAIL.notFound.body}</p>
              <div className={styles.actions}>
                <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="primary" size="large">
                  {JOB_DETAIL.notFound.primary}
                </Button>
                <Button as={Link} href={ROUTES.HOME} variant="secondary" size="large">
                  {JOB_DETAIL.notFound.secondary}
                </Button>
              </div>
            </div>
          </Container>
        </Section>
      </>
    );
  }

  if (status === RESOURCE_STATUS.ERROR || !job) {
    return (
      <>
        <PageMeta title="Careers at Valida" robots="noindex, follow" />
        <Section spacing="lg">
          <Container width="wide">
            <div className={styles.stateBlock} data-testid="job-error">
              <h1 className="t-h2">{JOB_DETAIL.error.heading}</h1>
              <p className="t-body-lg">{JOB_DETAIL.error.body}</p>
              <div className={styles.actions}>
                <Button variant="primary" size="large" onClick={reload}>
                  {JOB_DETAIL.error.primary}
                </Button>
                <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="secondary" size="large">
                  {JOB_DETAIL.error.secondary}
                </Button>
              </div>
            </div>
          </Container>
        </Section>
      </>
    );
  }

  const open = isJobOpen(job);
  const closed = isJobClosed(job);
  /*
   * One resolver for all three surfaces. Location and compensation come from
   * the Job's declared hiring markets matched against the visitor's regional
   * view; nothing is converted and nothing is inferred.
   */
  const presentation = resolveJobMarketPresentation(job, region);
  const facts = buildRegionalJobFacts(presentation);
  const responsibilities = toContentList(job.responsibilities);
  const requirements = toContentList(job.requirements);
  const preferred = toContentList(job.preferredQualifications);
  const description = typeof job.description === 'string' ? job.description.trim() : '';

  return (
    <>
      <PageMeta
        title={jobDetailTitle(job.title)}
        description={jobDetailDescription(job.title)}
        // A retained closed role stays reachable at its stable URL but should
        // not be indexed as an opportunity (Doc 16 policy).
        robots={closed ? 'noindex, follow' : undefined}
      />

      <Container width="wide">{breadcrumbs(job.title)}</Container>

      <section className={styles.hero} aria-labelledby="job-title">
        <Container width="wide">
          {closed ? (
            <p className={`t-label ${styles.closedBanner}`} data-testid="job-closed-banner">
              {JOB_DETAIL.closed.status}
            </p>
          ) : null}
          <h1 id="job-title" className={`t-h1 ${styles.title}`}>{job.title}</h1>
          <p className={`t-body ${styles.company}`}>Valida</p>
        </Container>
      </section>

      <Section spacing="md">
        <Container width="wide">
          <div className={styles.layout}>
            <aside className={styles.summary} aria-labelledby="job-details-heading">
              <Surface>
                <RegionSelector region={region} onChange={setRegion} />
                <h2 id="job-details-heading" className={`t-h4 ${styles.contentHeading}`}>
                  {JOB_DETAIL.labels.employmentDetails}
                </h2>
                {facts.length > 0 ? (
                  <dl className={styles.factList}>
                    {facts.map((fact) => (
                      <div key={fact.label}>
                        <dt className={`t-label ${styles.factTerm}`}>{fact.label}</dt>
                        <dd className={`t-body ${styles.factValue}`}>{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                <div className={`${styles.applyPanel} ${styles.applyPanelSpacing}`}>
                  {open ? (
                    <Button as={Link} href={withRegion(applyRoute(job.slug))} variant="primary" size="large">
                      {JOB_DETAIL.primaryCta}
                    </Button>
                  ) : (
                    <>
                      <p className={`t-body-sm ${styles.paragraph}`}>{JOB_DETAIL.closed.body}</p>
                      <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="secondary" size="large">
                        {JOB_DETAIL.closed.cta}
                      </Button>
                    </>
                  )}
                </div>
              </Surface>
            </aside>

            <div className={styles.content}>
              {description ? (
                <section className={styles.contentSection} aria-labelledby="job-about">
                  <h2 id="job-about" className={`t-h3 ${styles.contentHeading}`}>
                    {JOB_DETAIL.labels.about}
                  </h2>
                  <p className={`t-body-lg ${styles.paragraph}`}>{description}</p>
                </section>
              ) : null}

              {[
                { id: 'responsibilities', label: JOB_DETAIL.labels.responsibilities, items: responsibilities },
                { id: 'requirements', label: JOB_DETAIL.labels.requirements, items: requirements },
                { id: 'preferred', label: JOB_DETAIL.labels.preferredQualifications, items: preferred },
              ]
                // A section with no data is not rendered at all — no empty
                // heading, no placeholder (Doc 06 section 99).
                .filter((section) => section.items.length > 0)
                .map((section) => (
                  <section key={section.id} className={styles.contentSection} aria-labelledby={`job-${section.id}`}>
                    <h2 id={`job-${section.id}`} className={`t-h3 ${styles.contentHeading}`}>
                      {section.label}
                    </h2>
                    <ul className={styles.bulletList}>
                      {section.items.map((item) => (
                        <li key={item} className={`t-body ${styles.bullet}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
          </div>
        </Container>
      </Section>

      <Section spacing="lg" surface="secondary" aria-labelledby="job-final-cta">
        <Container width="wide">
          <div className={styles.finalCta}>
            {open ? (
              <>
                <h2 id="job-final-cta" className="t-h2">{JOB_DETAIL.finalCta.heading}</h2>
                <p className={`t-body-lg ${styles.paragraph}`}>{JOB_DETAIL.finalCta.body}</p>
                <Button as={Link} href={withRegion(applyRoute(job.slug))} variant="primary" size="large">
                  {JOB_DETAIL.finalCta.button}
                </Button>
              </>
            ) : (
              <>
                <h2 id="job-final-cta" className="t-h2">{JOB_DETAIL.closed.heading}</h2>
                <p className={`t-body-lg ${styles.paragraph}`}>{JOB_DETAIL.closed.body}</p>
                <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="primary" size="large">
                  {JOB_DETAIL.closed.cta}
                </Button>
              </>
            )}
          </div>
        </Container>
      </Section>
    </>
  );
}
