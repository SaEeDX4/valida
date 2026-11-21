import { Fragment } from 'react';
import { Link } from 'react-router';
import { useAdminSession } from '../AdminSession.jsx';
import { APPLICATION_STATUS_LABELS, ErrorAlert, Loading, PageHeader } from '../components.jsx';
import { useAdminResource } from '../useAdminResource.js';
import styles from '../admin.module.css';

/** Doc 12 s142-143 — only real recruitment numbers; no invented metrics. */
export function OverviewPage() {
  const session = useAdminSession();
  const canSee = session.can('jobs:read') && session.can('applications:read');
  const { data, error, loading } = useAdminResource(canSee ? '/admin/overview' : null);
  return (
    <>
      <PageHeader eyebrow="Recruitment" title={`Welcome, ${session.admin.displayName}`} lead="What needs attention across Valida's open roles." />
      <ErrorAlert error={error} title="The overview could not be loaded" />
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <section className={styles.stats} aria-label="Key numbers">
            <Link to="/admin/applications?status=RECEIVED" className={styles.stat}>
              <span className={styles.statValue}>{data.applications.awaitingReview}</span>
              <span className={styles.statLabel}>Applications awaiting review</span>
            </Link>
            <Link to="/admin/jobs" className={styles.stat}>
              <span className={styles.statValue}>{data.jobs.accepting}</span>
              <span className={styles.statLabel}>Jobs accepting applications</span>
            </Link>
            <div className={styles.stat}>
              <span className={styles.statValue}>{data.applications.total}</span>
              <span className={styles.statLabel}>Applications in total</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{data.applications.resumesAwaitingScan}</span>
              <span className={styles.statLabel}>Résumés not yet released by the scanner</span>
            </div>
          </section>
          <section className={styles.panel} aria-labelledby="by-status">
            <h2 id="by-status" className={styles.sectionTitle}>
              Applications by status
            </h2>
            {Object.keys(data.applications.byStatus).length === 0 ? (
              <p className={styles.muted}>No applications yet.</p>
            ) : (
              <dl className={styles.facts}>
                {Object.entries(APPLICATION_STATUS_LABELS)
                  .filter(([status]) => data.applications.byStatus[status])
                  .map(([status, label]) => (
                    <Fragment key={status}>
                      <dt>
                        <Link to={`/admin/applications?status=${status}`}>{label}</Link>
                      </dt>
                      <dd>{data.applications.byStatus[status]}</dd>
                    </Fragment>
                  ))}
              </dl>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
