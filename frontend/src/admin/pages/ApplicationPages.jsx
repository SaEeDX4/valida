import { Fragment, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import Alert from '../../components/ui/Alert/Alert.jsx';
import Button from '../../components/ui/Button/Button.jsx';
import Field from '../../components/ui/Field/Field.jsx';
import TextArea from '../../components/ui/TextArea/TextArea.jsx';
import TextInput from '../../components/ui/TextInput/TextInput.jsx';
import { adminApi } from '../api/adminClient.js';
import {
  APPLICATION_STATUS_LABELS,
  ApplicationStatusBadge,
  Badge,
  COMMUNICATION_KIND_LABELS,
  ErrorAlert,
  Loading,
  PageHeader,
  Pagination,
  ScanBadge,
  formatDateTime,
} from '../components.jsx';
import { useAdminResource, useSessionGuard } from '../useAdminResource.js';
import styles from '../admin.module.css';

/**
 * E4 — application management and secure résumé review; E5 — status, notes,
 * communications (Doc 12 s149-165, s85-121; Doc 11 s166-177).
 */

export function ApplicationsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const jobs = useAdminResource('/admin/jobs');
  const query = new URLSearchParams();
  for (const key of ['q', 'status', 'jobId', 'from', 'to', 'page']) if (params.get(key)) query.set(key, params.get(key));
  const { data, error, loading } = useAdminResource(`/admin/applications?${query.toString()}`);
  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  return (
    <>
      <PageHeader eyebrow="Recruitment" title="Applications" lead="Newest first. Open an application to review it, change its status, add notes and record communication." />
      <form
        className={styles.toolbar}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: q.trim() });
        }}
      >
        <Field label="Search name or email">
          {(props) => <TextInput {...props} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
        <Field label="Status">
          {(props) => (
            <select {...props} className={styles.select} value={params.get('status') ?? ''} onChange={(e) => update({ status: e.target.value })}>
              <option value="">All</option>
              {Object.entries(APPLICATION_STATUS_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Job">
          {(props) => (
            <select {...props} className={styles.select} value={params.get('jobId') ?? ''} onChange={(e) => update({ jobId: e.target.value })}>
              <option value="">All Jobs</option>
              {(jobs.data?.items ?? []).map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Submitted from">
          {(props) => <TextInput {...props} type="date" value={params.get('from') ?? ''} onChange={(e) => update({ from: e.target.value })} />}
        </Field>
        <Field label="Submitted to">
          {(props) => <TextInput {...props} type="date" value={params.get('to') ?? ''} onChange={(e) => update({ to: e.target.value })} />}
        </Field>
        <div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </div>
      </form>
      <ErrorAlert error={error} title="Applications could not be loaded" />
      {loading ? <Loading /> : null}
      {data && data.items.length === 0 ? <p className={styles.muted}>No applications match.</p> : null}
      {data && data.items.length > 0 ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col">Résumé</th>
                  <th scope="col">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link className={styles.rowLink} to={`/admin/applications/${item.id}`}>
                        {item.candidateName}
                      </Link>
                      <span className={styles.timelineMeta}>{item.candidateEmail}</span>
                      {item.possibleDuplicate ? <Badge tone="warning">Possible duplicate</Badge> : null}
                    </td>
                    <td>{item.job.title}</td>
                    <td>
                      <ApplicationStatusBadge status={item.status} />
                    </td>
                    <td>
                      <ScanBadge status={item.resumeScanStatus} />
                    </td>
                    <td>{formatDateTime(item.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pagination={data.pagination} onPage={(page) => update({ page: String(page) })} />
        </>
      ) : null}
    </>
  );
}

function StatusPanel({ application, allowed, onChanged }) {
  const guard = useSessionGuard();
  const [toStatus, setToStatus] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const target = allowed.find((s) => s.status === toStatus);
  const submit = async (event) => {
    event.preventDefault();
    if (!toStatus) return;
    setBusy(true);
    setError(null);
    try {
      // The expected current status travels with the change: a newer decision is never overwritten (E5).
      await adminApi.post(`/admin/applications/${application.id}/status`, { fromStatus: application.status, toStatus, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      setToStatus('');
      setReason('');
      onChanged();
    } catch (failure) {
      if (!guard(failure)) setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby="status-heading">
      <h2 id="status-heading" className={styles.sectionTitle}>
        Status
      </h2>
      <p>
        <ApplicationStatusBadge status={application.status} />
      </p>
      {error?.code === 'STATUS_CONFLICT' ? (
        <Alert tone="warning" title="Changed by someone else">
          {error.message}{' '}
          <Button variant="text" onClick={onChanged}>
            Reload
          </Button>
        </Alert>
      ) : (
        <ErrorAlert error={error} title="Status not changed" />
      )}
      {allowed.length === 0 ? (
        <p className={styles.muted}>This decision is final. Only an owner can reopen it, with a reason.</p>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <Field label="Move to">
            {(props) => (
              <select {...props} className={styles.select} value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
                <option value="">Choose a status</option>
                {allowed.map((s) => (
                  <option key={s.status} value={s.status}>
                    {APPLICATION_STATUS_LABELS[s.status]}
                    {s.correction ? ' (correction)' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={target?.correction ? 'Reason for the correction' : 'Reason'} optionalText={target?.correction ? undefined : 'Optional'} required={Boolean(target?.correction)} description="Internal only, never sent to the candidate.">
            {(props) => <TextArea {...props} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Button type="submit" loading={busy} disabled={!toStatus}>
            Change status
          </Button>
        </form>
      )}
      <h3 className={styles.sectionTitle}>History</h3>
      <ol className={styles.timeline}>
        {[...application.statusHistory].reverse().map((entry, index) => (
          <li key={index} className={styles.timelineItem}>
            {entry.fromStatus ? `${APPLICATION_STATUS_LABELS[entry.fromStatus]} → ` : ''}
            {APPLICATION_STATUS_LABELS[entry.toStatus]}
            {entry.reason ? <span className={styles.prewrap}> — {entry.reason}</span> : null}
            <span className={styles.timelineMeta}>
              {entry.changedBy} · {formatDateTime(entry.changedAt)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NotesPanel({ application, canWrite, onChanged }) {
  const guard = useSessionGuard();
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.post(`/admin/applications/${application.id}/notes`, { body });
      setBody('');
      onChanged();
    } catch (failure) {
      if (!guard(failure)) setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby="notes-heading">
      <h2 id="notes-heading" className={styles.sectionTitle}>
        Internal notes
      </h2>
      <p className={styles.lead}>Visible to the recruitment team only. Notes cannot be edited; add a new note to correct one.</p>
      {canWrite ? (
        <form className={styles.form} onSubmit={submit}>
          <ErrorAlert error={error} title="Note not added" />
          <Field label="New note">
            {(props) => <TextArea {...props} rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />}
          </Field>
          <Button type="submit" variant="secondary" loading={busy} disabled={!body.trim()}>
            Add note
          </Button>
        </form>
      ) : null}
      {application.notes.length === 0 ? <p className={styles.muted}>No notes yet.</p> : null}
      <ol className={styles.timeline}>
        {[...application.notes].reverse().map((note) => (
          <li key={note.id} className={styles.timelineItem}>
            <span className={styles.prewrap}>{note.body}</span>
            <span className={styles.timelineMeta}>
              {note.author} · {formatDateTime(note.createdAt)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CommunicationsPanel({ application, canRecord, onChanged }) {
  const guard = useSessionGuard();
  const [form, setForm] = useState({ kind: 'SCREENING', direction: 'OUTBOUND', subject: '', summary: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.post(`/admin/applications/${application.id}/communications`, {
        kind: form.kind,
        direction: form.direction,
        ...(form.subject.trim() ? { subject: form.subject.trim() } : {}),
        ...(form.summary.trim() ? { summary: form.summary.trim() } : {}),
      });
      setForm({ ...form, subject: '', summary: '' });
      onChanged();
    } catch (failure) {
      if (!guard(failure)) setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby="comms-heading">
      <h2 id="comms-heading" className={styles.sectionTitle}>
        Communication
      </h2>
      <p className={styles.lead}>Write to the candidate from the careers@ mailbox, then record what was sent or received here.</p>
      {canRecord ? (
        <form className={styles.form} onSubmit={submit}>
          <ErrorAlert error={error} title="Not recorded" />
          <div className={styles.formRow}>
            <Field label="Kind">
              {(props) => (
                <select {...props} className={styles.select} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {Object.entries(COMMUNICATION_KIND_LABELS)
                    .filter(([k]) => k !== 'APPLICATION_ACKNOWLEDGEMENT')
                    .map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field label="Direction">
              {(props) => (
                <select {...props} className={styles.select} value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                  <option value="OUTBOUND">Sent to the candidate</option>
                  <option value="INBOUND">Received from the candidate</option>
                </select>
              )}
            </Field>
          </div>
          <Field label="Subject" optionalText="Optional">
            {(props) => <TextInput {...props} maxLength={300} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}
          </Field>
          <Field label="Summary" optionalText="Optional" description="A short internal summary, not the whole email.">
            {(props) => <TextArea {...props} rows={3} maxLength={1000} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />}
          </Field>
          <Button type="submit" variant="secondary" loading={busy}>
            Record communication
          </Button>
        </form>
      ) : null}
      {application.communications.length === 0 ? <p className={styles.muted}>Nothing recorded yet.</p> : null}
      <ol className={styles.timeline}>
        {application.communications.map((c, index) => (
          <li key={c.communicationId ?? `auto-${index}`} className={styles.timelineItem}>
            <strong>{COMMUNICATION_KIND_LABELS[c.kind] ?? c.kind}</strong> · {c.direction === 'INBOUND' ? 'received' : 'sent'} · {c.status === 'RECORDED_EXTERNAL' ? 'recorded' : c.status.toLowerCase()}
            {c.subject ? <span className={styles.prewrap}> — {c.subject}</span> : null}
            {c.summary ? <span className={`${styles.prewrap} ${styles.timelineMeta}`}>{c.summary}</span> : null}
            <span className={styles.timelineMeta}>
              {c.actorName} · {formatDateTime(c.occurredAt)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResumePanel({ application }) {
  const guard = useSessionGuard();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const resume = application.resume;
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await adminApi.download(`/admin/applications/${application.id}/resume`);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (failure) {
      if (!guard(failure)) setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby="resume-heading">
      <h2 id="resume-heading" className={styles.sectionTitle}>
        Résumé
      </h2>
      <dl className={styles.facts}>
        <dt>File</dt>
        <dd>{resume.originalFilename}</dd>
        <dt>Type and size</dt>
        <dd>
          {resume.extension.replace('.', '').toUpperCase()} · {Math.max(1, Math.round(resume.sizeBytes / 1024))} KB
        </dd>
        <dt>Security scan</dt>
        <dd>
          <ScanBadge status={resume.scanStatus} /> {resume.scanCheckedAt ? <span className={styles.timelineMeta}>{formatDateTime(resume.scanCheckedAt)}</span> : null}
        </dd>
      </dl>
      <ErrorAlert error={error} title="Not downloaded" />
      {resume.available ? (
        <Button onClick={download} loading={busy}>
          Download résumé
        </Button>
      ) : (
        <Alert tone="warning" title="Not available yet">
          A résumé is released only after the malware scan marks it clean.
        </Alert>
      )}
    </section>
  );
}

export function ApplicationPage() {
  const { applicationId } = useParams();
  const { data, error, loading, reload } = useAdminResource(`/admin/applications/${applicationId}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorAlert error={error} title="This application could not be loaded" />;
  if (!data) return null;
  const { application, allowedNextStatuses, permissions } = data;
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/admin/applications">Applications</Link>}
        title={application.candidate.fullName}
        lead={`Applied for ${application.appliedRole.title} · ${formatDateTime(application.submittedAt)}`}
        actions={<ApplicationStatusBadge status={application.status} />}
      />
      {application.duplicates.length ? (
        <Alert tone="info" title="Other applications from this email for this Job">
          {application.duplicates.map((d) => (
            <span key={d.id}>
              <Link to={`/admin/applications/${d.id}`}>{formatDateTime(d.submittedAt)}</Link> ({APPLICATION_STATUS_LABELS[d.status]}){' '}
            </span>
          ))}
        </Alert>
      ) : null}
      <div className={styles.grid2}>
        <div className={styles.form}>
          <section className={styles.panel} aria-labelledby="candidate-heading">
            <h2 id="candidate-heading" className={styles.sectionTitle}>
              Candidate
            </h2>
            <dl className={styles.facts}>
              <dt>Name</dt>
              <dd>{application.candidate.fullName}</dd>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${application.candidate.email}`}>{application.candidate.email}</a>
              </dd>
              <dt>Phone</dt>
              <dd>{application.candidate.phone ?? '—'}</dd>
            </dl>
            {application.candidate.message ? (
              <>
                <h3 className={styles.sectionTitle}>Message</h3>
                <p className={styles.prewrap}>{application.candidate.message}</p>
              </>
            ) : null}
            {application.screeningAnswers.length ? (
              <>
                <h3 className={styles.sectionTitle}>Screening answers</h3>
                <dl className={styles.facts}>
                  {application.screeningAnswers.map((answer, index) => (
                    <Fragment key={index}>
                      <dt>{answer.prompt}</dt>
                      <dd className={styles.prewrap}>{answer.answer ?? '—'}</dd>
                    </Fragment>
                  ))}
                </dl>
              </>
            ) : null}
          </section>
          <section className={styles.panel} aria-labelledby="role-heading">
            <h2 id="role-heading" className={styles.sectionTitle}>
              Applied role (snapshot)
            </h2>
            <dl className={styles.facts}>
              <dt>Title</dt>
              <dd>{application.appliedRole.title}</dd>
              <dt>Location</dt>
              <dd>{application.appliedRole.location ?? '—'}</dd>
              <dt>Hours</dt>
              <dd>{application.appliedRole.weeklyHours ?? '—'}</dd>
            </dl>
            {application.currentJob ? (
              <p className={styles.lead}>
                Current Job: <Link to={`/admin/jobs/${application.currentJob.id}`}>{application.currentJob.title}</Link>
                {application.currentJob.changedSinceApplication ? ' — changed since this application.' : ''}
              </p>
            ) : null}
          </section>
          <CommunicationsPanel application={application} canRecord={permissions.recordCommunication} onChanged={reload} />
        </div>
        <div className={styles.form}>
          <ResumePanel application={application} />
          {permissions.updateStatus ? <StatusPanel application={application} allowed={allowedNextStatuses} onChanged={reload} /> : null}
          <NotesPanel application={application} canWrite={permissions.writeNotes} onChanged={reload} />
        </div>
      </div>
    </>
  );
}
