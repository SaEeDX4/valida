import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import Alert from '../../components/ui/Alert/Alert.jsx';
import Button from '../../components/ui/Button/Button.jsx';
import Field from '../../components/ui/Field/Field.jsx';
import TextArea from '../../components/ui/TextArea/TextArea.jsx';
import TextInput from '../../components/ui/TextInput/TextInput.jsx';
import { adminApi } from '../api/adminClient.js';
import { useAdminSession } from '../AdminSession.jsx';
import { ConfirmDialog, ErrorAlert, JobStatusBadge, Loading, PageHeader, formatDateTime } from '../components.jsx';
import { useAdminResource, useSessionGuard } from '../useAdminResource.js';
import styles from '../admin.module.css';

/**
 * E3 — Job management (Doc 12 s12-41, s144-148). The server applies every
 * rule (provisioning path); these screens collect input and explain outcomes.
 */

const ARRANGEMENTS = { FULLY_REMOTE: 'Fully remote', HYBRID: 'Hybrid', ON_SITE: 'On site' };
const EMPLOYMENT = { FULL_TIME: 'Full time', PART_TIME: 'Part time', FIXED_TERM: 'Fixed term', CONTRACT: 'Contract', TEMPORARY: 'Temporary', INTERNSHIP: 'Internship', OTHER: 'Other' };
const UNITS = { HOUR: 'per hour', MONTH: 'per month', YEAR: 'per year' };
const QUESTION_TYPES = { YES_NO: 'Yes / no', SHORT_TEXT: 'Short text', LONG_TEXT: 'Long text', SINGLE_SELECT: 'Single choice' };

const ACTION_COPY = {
  publish: { label: 'Publish', title: 'Publish this Job?', body: 'It becomes visible on the Careers page and accepts applications (when recruitment is open on this site).', destructive: false },
  reopen: { label: 'Reopen', title: 'Reopen this Job?', body: 'It accepts applications again. Its first publication date is kept.', destructive: false },
  close: { label: 'Close', title: 'Close this Job?', body: 'It stops accepting applications immediately. Candidates with the form open will be told it closed.', destructive: true },
  archive: { label: 'Archive', title: 'Archive this Job?', body: 'It disappears from the public site. Its applications stay available here. This cannot be undone.', destructive: true },
};

export function JobsPage() {
  const session = useAdminSession();
  const [status, setStatus] = useState('');
  const { data, error, loading } = useAdminResource(`/admin/jobs${status ? `?status=${status}` : ''}`);
  return (
    <>
      <PageHeader
        eyebrow="Recruitment"
        title="Jobs"
        lead="Create roles as drafts, preview them, then publish. Closing or archiving never deletes applications."
        actions={session.can('jobs:create') ? <Button href="/admin/jobs/new" as={Link}>New Job</Button> : null}
      />
      <div className={styles.toolbar}>
        <Field label="Status">
          {(props) => (
            <select {...props} className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="CLOSED">Closed</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          )}
        </Field>
      </div>
      <ErrorAlert error={error} title="Jobs could not be loaded" />
      {loading ? <Loading /> : null}
      {data && data.items.length === 0 ? <p className={styles.muted}>No Jobs yet.</p> : null}
      {data && data.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Location</th>
                <th scope="col">Closes</th>
                <th scope="col">Applications</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className={styles.rowLink} to={`/admin/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <span className={styles.timelineMeta}>/{job.slug}</span>
                  </td>
                  <td>
                    <JobStatusBadge status={job.status} /> {job.status === 'PUBLISHED' && !job.accepting ? <span className={styles.timelineMeta}>Not accepting</span> : null}
                  </td>
                  <td>{job.location ?? '—'}</td>
                  <td>{job.closesAt ? formatDateTime(job.closesAt) : '—'}</td>
                  <td>
                    <Link to={`/admin/applications?jobId=${job.id}`}>{job.applicationCount}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function money(content) {
  const c = content.compensation;
  if (!c?.currency || c.amountMinor === null) return '—';
  return `${c.currency} ${(c.amountMinor / 100).toFixed(2)} ${UNITS[c.unit] ?? ''}${c.gross ? ' (gross)' : ''}`;
}

export function JobViewPage() {
  const { jobId } = useParams();
  const session = useAdminSession();
  const guard = useSessionGuard();
  const { data, error, loading, reload } = useAdminResource(`/admin/jobs/${jobId}`);
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [preview, setPreview] = useState(null);

  const run = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await adminApi.post(`/admin/jobs/${jobId}/${action}`);
      setAction(null);
      reload();
    } catch (failure) {
      if (!guard(failure)) setActionError(failure);
      setAction(null);
    } finally {
      setBusy(false);
    }
  };
  const loadPreview = async () => {
    setActionError(null);
    try {
      setPreview((await adminApi.get(`/admin/jobs/${jobId}/preview`)).preview);
    } catch (failure) {
      if (!guard(failure)) setActionError(failure);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorAlert error={error} title="This Job could not be loaded" />;
  if (!data) return null;
  const { job, publishProblems, allowedActions } = data;
  const content = job.content;
  return (
    <>
      <PageHeader
        eyebrow={<Link to="/admin/jobs">Jobs</Link>}
        title={job.title}
        lead={`/careers/${job.slug}`}
        actions={
          <>
            <JobStatusBadge status={job.status} />
            {session.can('jobs:update') && job.status !== 'ARCHIVED' ? (
              <Button variant="secondary" href={`/admin/jobs/${job.id}/edit`} as={Link}>
                Edit
              </Button>
            ) : null}
            <Button variant="secondary" onClick={loadPreview}>
              Preview
            </Button>
            {allowedActions.map((name) => (
              <Button key={name} variant={ACTION_COPY[name].destructive ? 'destructive' : 'primary'} onClick={() => setAction(name)}>
                {ACTION_COPY[name].label}
              </Button>
            ))}
          </>
        }
      />
      <ErrorAlert error={actionError} title="The change was not made" />
      {actionError?.fieldErrors?.length ? (
        <ul>
          {actionError.fieldErrors.map((f) => (
            <li key={f.code + f.message}>{f.message}</li>
          ))}
        </ul>
      ) : null}
      {job.status === 'DRAFT' && publishProblems.length > 0 ? (
        <Alert tone="warning" title="Not ready to publish">
          Still needed: {publishProblems.join(', ')}.
        </Alert>
      ) : null}
      <div className={styles.grid2}>
        <section className={styles.panel} aria-labelledby="job-content">
          <h2 id="job-content" className={styles.sectionTitle}>
            Role
          </h2>
          <dl className={styles.facts}>
            <dt>Location</dt>
            <dd>{content.location.displayName ?? '—'}</dd>
            <dt>Arrangement</dt>
            <dd>{ARRANGEMENTS[content.workArrangement] ?? '—'}</dd>
            <dt>Employment</dt>
            <dd>{EMPLOYMENT[content.employmentType] ?? '—'}</dd>
            <dt>Schedule</dt>
            <dd>
              {content.schedule ?? '—'}
              {content.weeklyHours ? ` · ${content.weeklyHours} h/week` : ''}
            </dd>
            <dt>Pay</dt>
            <dd>{money(content)}</dd>
            <dt>Closes</dt>
            <dd>{content.closesAt ? formatDateTime(content.closesAt) : 'No closing date'}</dd>
          </dl>
          <h3 className={styles.sectionTitle}>Description</h3>
          <p className={styles.prewrap}>{content.description || '—'}</p>
          {[
            ['Responsibilities', content.responsibilities],
            ['Requirements', content.requirements],
            ['Preferred qualifications', content.preferredQualifications],
          ].map(([label, items]) => (
            <div key={label}>
              <h3 className={styles.sectionTitle}>{label}</h3>
              {items.length ? (
                <ul>
                  {items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>None.</p>
              )}
            </div>
          ))}
        </section>
        <section className={styles.panel} aria-labelledby="job-meta">
          <h2 id="job-meta" className={styles.sectionTitle}>
            Publication
          </h2>
          <dl className={styles.facts}>
            <dt>Status</dt>
            <dd>
              <JobStatusBadge status={job.status} />
            </dd>
            <dt>Accepting now</dt>
            <dd>{job.accepting ? 'Yes' : 'No'}</dd>
            <dt>First published</dt>
            <dd>{formatDateTime(job.publishedAt)}</dd>
            <dt>Applications</dt>
            <dd>
              <Link to={`/admin/applications?jobId=${job.id}`}>{job.applicationCount}</Link>
            </dd>
            <dt>Screening questions</dt>
            <dd>{content.applicationConfig.screeningQuestions.length}</dd>
          </dl>
        </section>
      </div>
      {preview ? (
        <section className={styles.panel} aria-labelledby="job-preview">
          <h2 id="job-preview" className={styles.sectionTitle}>
            Preview — as candidates would see it
          </h2>
          <p className={styles.title}>{preview.title}</p>
          <p className={styles.lead}>{preview.location}</p>
          <p className={styles.prewrap}>{preview.description}</p>
        </section>
      ) : null}
      <ConfirmDialog
        open={Boolean(action)}
        title={action ? ACTION_COPY[action].title : ''}
        body={action ? ACTION_COPY[action].body : ''}
        confirmLabel={action ? ACTION_COPY[action].label : ''}
        destructive={action ? ACTION_COPY[action].destructive : false}
        busy={busy}
        onConfirm={run}
        onCancel={() => setAction(null)}
      />
    </>
  );
}

/* ---------------------------------------------------------------- editor -- */

const EMPTY = {
  slug: '',
  title: '',
  internalOccupationalReference: '',
  location: { displayName: '', countryCode: 'CA', regionCode: '', locality: '' },
  workArrangement: 'FULLY_REMOTE',
  eligibleWorkCountries: '',
  employmentType: 'PART_TIME',
  schedule: '',
  weeklyHours: '',
  compensation: { currency: 'CAD', amount: '', unit: 'HOUR', gross: true },
  description: '',
  responsibilities: [''],
  requirements: [''],
  preferredQualifications: [],
  applicationConfig: { phone: { enabled: true, required: false }, message: { enabled: true, required: false, maxLength: 2000 }, screeningQuestions: [] },
  closesAt: '',
};

function fromContent(content, slug) {
  const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
  return {
    slug,
    title: content.title ?? '',
    internalOccupationalReference: content.internalOccupationalReference ?? '',
    location: { displayName: content.location.displayName ?? '', countryCode: content.location.countryCode ?? '', regionCode: content.location.regionCode ?? '', locality: content.location.locality ?? '' },
    workArrangement: content.workArrangement ?? '',
    eligibleWorkCountries: (content.eligibleWorkCountries ?? []).join(', '),
    employmentType: content.employmentType ?? '',
    schedule: content.schedule ?? '',
    weeklyHours: content.weeklyHours ?? '',
    compensation: { currency: content.compensation.currency ?? 'CAD', amount: content.compensation.amountMinor === null ? '' : (content.compensation.amountMinor / 100).toFixed(2), unit: content.compensation.unit ?? 'HOUR', gross: content.compensation.gross ?? true },
    description: content.description ?? '',
    responsibilities: content.responsibilities.length ? content.responsibilities : [''],
    requirements: content.requirements.length ? content.requirements : [''],
    preferredQualifications: content.preferredQualifications,
    applicationConfig: content.applicationConfig,
    closesAt: toLocal(content.closesAt),
  };
}

const orNull = (value) => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);

function toDefinition(form) {
  const amount = form.compensation.amount === '' ? null : Math.round(Number(form.compensation.amount) * 100);
  const countries = form.eligibleWorkCountries.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  return {
    slug: form.slug.trim(),
    title: form.title.trim(),
    internalOccupationalReference: orNull(form.internalOccupationalReference),
    location: { displayName: orNull(form.location.displayName), countryCode: orNull(form.location.countryCode?.toUpperCase()), regionCode: orNull(form.location.regionCode), locality: orNull(form.location.locality) },
    workArrangement: form.workArrangement || null,
    eligibleWorkCountries: countries,
    employmentType: form.employmentType || null,
    schedule: orNull(form.schedule),
    weeklyHours: form.weeklyHours === '' ? null : Number(form.weeklyHours),
    compensation: { currency: form.compensation.currency || null, amountMinor: Number.isFinite(amount) ? amount : null, unit: form.compensation.unit || null, gross: form.compensation.gross },
    description: form.description.trim(),
    responsibilities: form.responsibilities.map((s) => s.trim()).filter(Boolean),
    requirements: form.requirements.map((s) => s.trim()).filter(Boolean),
    preferredQualifications: form.preferredQualifications.map((s) => s.trim()).filter(Boolean),
    applicationConfig: {
      resumeRequired: true,
      phone: form.applicationConfig.phone,
      message: { ...form.applicationConfig.message, maxLength: Number(form.applicationConfig.message.maxLength) || 5000 },
      screeningQuestions: form.applicationConfig.screeningQuestions.map((q) => ({
        ...(q.questionId ? { questionId: q.questionId } : {}),
        type: q.type,
        prompt: q.prompt.trim(),
        required: Boolean(q.required),
        options: q.type === 'SINGLE_SELECT' ? q.options.filter((o) => o.label.trim()).map((o) => ({ ...(o.optionId ? { optionId: o.optionId } : {}), label: o.label.trim() })) : [],
      })),
    },
    closesAt: form.closesAt ? new Date(form.closesAt).toISOString() : null,
  };
}

function ListEditor({ label, items, onChange, description }) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{label}</legend>
      {description ? <p className={styles.lead}>{description}</p> : null}
      {items.map((item, index) => (
        <div key={index} className={styles.listEditorItem}>
          <Field label={`${label} ${index + 1}`}>
            {(props) => <TextInput {...props} value={item} onChange={(e) => onChange(items.map((v, i) => (i === index ? e.target.value : v)))} />}
          </Field>
          <Button variant="ghost" size="compact" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="compact" onClick={() => onChange([...items, ''])}>
        Add {label.toLowerCase().replace(/s$/, '')}
      </Button>
    </fieldset>
  );
}

export function JobEditorPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const guard = useSessionGuard();
  const editing = Boolean(jobId);
  const { data, error: loadError, loading } = useAdminResource(editing ? `/admin/jobs/${jobId}` : null);
  const initial = useMemo(() => (editing && data ? fromContent(data.job.content, data.job.slug) : EMPTY), [editing, data]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmMaterial, setConfirmMaterial] = useState(false);
  const value = form ?? initial;
  const set = (patch) => setForm({ ...value, ...patch });
  const fieldError = (name) => error?.fieldErrors?.find((f) => f.field === name || f.field.startsWith(`${name}.`))?.message;

  if (editing && loading) return <Loading />;
  if (loadError) return <ErrorAlert error={loadError} title="This Job could not be loaded" />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const definition = toDefinition(value);
      if (editing) {
        await adminApi.patch(`/admin/jobs/${jobId}`, { ...definition, confirmMaterialChange: confirmMaterial });
        navigate(`/admin/jobs/${jobId}`);
      } else {
        const created = await adminApi.post('/admin/jobs', definition);
        navigate(`/admin/jobs/${created.job.id}`);
      }
    } catch (failure) {
      if (!guard(failure)) setError(failure);
      setBusy(false);
    }
  };

  const questions = value.applicationConfig.screeningQuestions;
  const setQuestions = (next) => set({ applicationConfig: { ...value.applicationConfig, screeningQuestions: next } });

  return (
    <>
      <PageHeader eyebrow={<Link to="/admin/jobs">Jobs</Link>} title={editing ? `Edit: ${data?.job.title ?? ''}` : 'New Job'} lead={editing ? 'Changes to a published role apply immediately.' : 'A new Job is saved as a Draft. Publish it from its page when it is complete.'} />
      <form className={styles.form} onSubmit={submit} noValidate>
        <ErrorAlert error={error} title="Not saved" />
        {error?.code === 'MATERIAL_CHANGE_CONFIRMATION_REQUIRED' ? (
          <label className={styles.checkbox}>
            <input type="checkbox" checked={confirmMaterial} onChange={(e) => setConfirmMaterial(e.target.checked)} /> This is a genuine correction of the existing role (applications already exist)
          </label>
        ) : null}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Role identity</legend>
          <Field label="Title" required error={fieldError('title')}>
            {(props) => <TextInput {...props} value={value.title} onChange={(e) => set({ title: e.target.value })} />}
          </Field>
          <Field label="URL slug" required description={editing ? 'Fixed: the slug is the role’s public address.' : 'Lowercase words joined by hyphens, e.g. security-analyst.'} error={fieldError('slug')}>
            {(props) => <TextInput {...props} value={value.slug} readOnly={editing} onChange={(e) => set({ slug: e.target.value })} />}
          </Field>
          <Field label="Internal occupational reference" optionalText="Optional" error={fieldError('internalOccupationalReference')}>
            {(props) => <TextInput {...props} value={value.internalOccupationalReference} onChange={(e) => set({ internalOccupationalReference: e.target.value })} />}
          </Field>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Employment details</legend>
          <div className={styles.formRow}>
            <Field label="Location shown to candidates" error={fieldError('location')}>
              {(props) => <TextInput {...props} value={value.location.displayName} onChange={(e) => set({ location: { ...value.location, displayName: e.target.value } })} />}
            </Field>
            <Field label="Country code" description="Two letters, e.g. CA.">
              {(props) => <TextInput {...props} value={value.location.countryCode} maxLength={2} onChange={(e) => set({ location: { ...value.location, countryCode: e.target.value } })} />}
            </Field>
            <Field label="Region code" optionalText="Optional">
              {(props) => <TextInput {...props} value={value.location.regionCode} onChange={(e) => set({ location: { ...value.location, regionCode: e.target.value } })} />}
            </Field>
          </div>
          <div className={styles.formRow}>
            <Field label="Work arrangement" error={fieldError('workArrangement')}>
              {(props) => (
                <select {...props} className={styles.select} value={value.workArrangement} onChange={(e) => set({ workArrangement: e.target.value })}>
                  <option value="">Not set</option>
                  {Object.entries(ARRANGEMENTS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Employment type" error={fieldError('employmentType')}>
              {(props) => (
                <select {...props} className={styles.select} value={value.employmentType} onChange={(e) => set({ employmentType: e.target.value })}>
                  <option value="">Not set</option>
                  {Object.entries(EMPLOYMENT).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label="Eligible work countries" optionalText="Optional" description="Fully remote roles only. Two-letter codes separated by commas, e.g. CA, DE. Leave empty for none." error={fieldError('eligibleWorkCountries')}>
            {(props) => <TextInput {...props} value={value.eligibleWorkCountries} onChange={(e) => set({ eligibleWorkCountries: e.target.value })} />}
          </Field>
          <div className={styles.formRow}>
            <Field label="Schedule" error={fieldError('schedule')}>
              {(props) => <TextInput {...props} value={value.schedule} onChange={(e) => set({ schedule: e.target.value })} />}
            </Field>
            <Field label="Weekly hours" error={fieldError('weeklyHours')}>
              {(props) => <TextInput {...props} type="number" min="0" max="168" step="0.5" value={value.weeklyHours} onChange={(e) => set({ weeklyHours: e.target.value })} />}
            </Field>
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Compensation</legend>
          <div className={styles.formRow}>
            <Field label="Amount (CAD)" error={fieldError('compensation')}>
              {(props) => <TextInput {...props} type="number" min="0" step="0.01" value={value.compensation.amount} onChange={(e) => set({ compensation: { ...value.compensation, amount: e.target.value } })} />}
            </Field>
            <Field label="Per">
              {(props) => (
                <select {...props} className={styles.select} value={value.compensation.unit} onChange={(e) => set({ compensation: { ...value.compensation, unit: e.target.value } })}>
                  {Object.entries(UNITS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l.replace('per ', '')}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={value.compensation.gross} onChange={(e) => set({ compensation: { ...value.compensation, gross: e.target.checked } })} /> Gross (before deductions)
          </label>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Role description</legend>
          <Field label="Description" error={fieldError('description')}>
            {(props) => <TextArea {...props} rows={8} value={value.description} onChange={(e) => set({ description: e.target.value })} />}
          </Field>
        </fieldset>
        <ListEditor label="Responsibilities" items={value.responsibilities} onChange={(responsibilities) => set({ responsibilities })} />
        <ListEditor label="Requirements" items={value.requirements} onChange={(requirements) => set({ requirements })} />
        <ListEditor label="Preferred qualifications" items={value.preferredQualifications} onChange={(preferredQualifications) => set({ preferredQualifications })} />
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Application form</legend>
          <p className={styles.lead}>Name, email and a résumé (PDF or DOCX) are always required.</p>
          {[
            ['phone', 'Phone number'],
            ['message', 'Message to the hiring team'],
          ].map(([key, label]) => (
            <div key={key} className={styles.actions}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={value.applicationConfig[key].enabled}
                  onChange={(e) => set({ applicationConfig: { ...value.applicationConfig, [key]: { ...value.applicationConfig[key], enabled: e.target.checked, required: e.target.checked && value.applicationConfig[key].required } } })}
                />{' '}
                Ask for {label.toLowerCase()}
              </label>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  disabled={!value.applicationConfig[key].enabled}
                  checked={value.applicationConfig[key].required}
                  onChange={(e) => set({ applicationConfig: { ...value.applicationConfig, [key]: { ...value.applicationConfig[key], required: e.target.checked } } })}
                />{' '}
                Required
              </label>
            </div>
          ))}
          <h3 className={styles.sectionTitle}>Screening questions</h3>
          {questions.map((question, index) => (
            <fieldset key={question.questionId ?? `new-${index}`} className={styles.fieldset}>
              <legend className={styles.legend}>Question {index + 1}</legend>
              <div className={styles.formRow}>
                <Field label="Type">
                  {(props) => (
                    <select {...props} className={styles.select} value={question.type} disabled={Boolean(question.questionId)} onChange={(e) => setQuestions(questions.map((q, i) => (i === index ? { ...q, type: e.target.value, options: e.target.value === 'SINGLE_SELECT' ? [{ label: '' }, { label: '' }] : [] } : q)))}>
                      {Object.entries(QUESTION_TYPES).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <label className={styles.checkbox}>
                  <input type="checkbox" checked={question.required} onChange={(e) => setQuestions(questions.map((q, i) => (i === index ? { ...q, required: e.target.checked } : q)))} /> Required
                </label>
              </div>
              <Field label="Question">
                {(props) => <TextInput {...props} value={question.prompt} onChange={(e) => setQuestions(questions.map((q, i) => (i === index ? { ...q, prompt: e.target.value } : q)))} />}
              </Field>
              {question.type === 'SINGLE_SELECT' ? (
                <ListEditor
                  label="Options"
                  items={question.options.map((o) => o.label)}
                  onChange={(labels) => setQuestions(questions.map((q, i) => (i === index ? { ...q, options: labels.map((label, j) => ({ ...(q.options[j]?.optionId ? { optionId: q.options[j].optionId } : {}), label })) } : q)))}
                />
              ) : null}
              <Button variant="ghost" size="compact" onClick={() => setQuestions(questions.filter((_, i) => i !== index))}>
                Remove question {index + 1}
              </Button>
            </fieldset>
          ))}
          <Button variant="secondary" size="compact" onClick={() => setQuestions([...questions, { type: 'YES_NO', prompt: '', required: false, options: [] }])}>
            Add screening question
          </Button>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Publication</legend>
          <Field label="Closing date and time" optionalText="Optional" description="After this time the role stops accepting applications automatically." error={fieldError('closesAt')}>
            {(props) => <TextInput {...props} type="datetime-local" value={value.closesAt} onChange={(e) => set({ closesAt: e.target.value })} />}
          </Field>
        </fieldset>
        {error?.fieldErrors?.length ? (
          <Alert tone="error" title="Fields to check">
            <ul>
              {error.fieldErrors.map((f, i) => (
                <li key={i}>
                  {f.field}: {f.message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div className={styles.actions}>
          <Button type="submit" loading={busy}>
            {editing ? 'Save changes' : 'Save as Draft'}
          </Button>
          <Button variant="secondary" href={editing ? `/admin/jobs/${jobId}` : '/admin/jobs'} as={Link}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
