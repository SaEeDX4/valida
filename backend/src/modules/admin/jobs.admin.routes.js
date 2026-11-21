import express from 'express';
import mongoose from 'mongoose';
import { AppError, ERROR_CODES } from '../../errors/AppError.js';
import { successEnvelope } from '../../lib/envelope.js';
import { Job, JOB_STATUSES } from '../../models/Job.js';
import { Application } from '../../models/Application.js';
import { canonicalJobContent, jobDefinitionSchema, provisionJob } from '../jobs/job.provisioning.js';
import { checkPublishReadiness, effectiveApplicationStatus } from '../jobs/job.service.js';
import { toPublicJobDetail } from '../jobs/job.mapper.js';
import { requirePermission } from './session.js';

/**
 * /api/v1/admin/jobs — E3 Job management (Doc 12 sections 12-41, 141-148;
 * Doc 11 s150, s160).
 *
 * Every write goes through the SAME validated path as operator provisioning
 * (job.provisioning.js → provisionJob): the strict definition schema, DRAFT-only
 * creation, the permitted transitions, publish readiness, publishedAt and the
 * slug fixed once published, screening identifiers never rewritten, and the
 * material-change confirmation when Applications exist (Doc 12 s41). The Admin
 * API adds authorization, the browser contract and audit — no second set of rules.
 */

const fail = (status, code, message, fieldErrors) => new AppError({ status, code, message, ...(fieldErrors ? { fieldErrors } : {}) });
const notFound = () => fail(404, 'JOB_NOT_FOUND', 'That Job was not found.');

const LIFECYCLE = Object.freeze({
  publish: { from: ['DRAFT'], to: 'PUBLISHED', permission: 'jobs:publish', action: 'JOB_PUBLISHED' },
  reopen: { from: ['CLOSED'], to: 'PUBLISHED', permission: 'jobs:publish', action: 'JOB_REOPENED' },
  close: { from: ['PUBLISHED'], to: 'CLOSED', permission: 'jobs:close', action: 'JOB_CLOSED' },
  archive: { from: ['DRAFT', 'CLOSED'], to: 'ARCHIVED', permission: 'jobs:archive', action: 'JOB_ARCHIVED' },
});

function parseDefinition(raw) {
  const result = jobDefinitionSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new AppError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: 'Some fields need attention.',
    fieldErrors: result.error.issues.slice(0, 50).map((issue) => ({ field: issue.path.join('.') || 'job', code: 'INVALID', message: issue.message })),
  });
}

/** The editable content of a request: everything the definition holds except identity and lifecycle. */
function contentFromBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  const { slug: _slug, status: _status, awaitingInput: _a, notes: _n, confirmMaterialChange: _c, ...content } = body;
  return content;
}

function outcomeError(result) {
  const refusals = result.refusals ?? [];
  if (refusals.some((r) => r.code === 'MATERIAL_CHANGE_CONFIRMATION_REQUIRED')) {
    return fail(409, 'MATERIAL_CHANGE_CONFIRMATION_REQUIRED', 'Applications already exist for this Job. Confirm that this change to its substance is a genuine correction.', refusals.map((r) => ({ field: r.code, code: r.code, message: r.message })));
  }
  if (result.outcome === 'refused') {
    return fail(409, 'JOB_CHANGE_REFUSED', 'The change was not made.', refusals.map((r) => ({ field: r.code, code: r.code, message: r.message })));
  }
  return fail(503, 'JOB_CHANGE_UNCONFIRMED', 'The change could not be confirmed. Reload the Job before trying again.');
}

async function applicationCount(jobId) {
  return Application.countDocuments({ jobId: { $eq: jobId } });
}

export function toAdminJobSummary(job, { now, applications = null }) {
  return {
    id: String(job._id),
    title: job.title,
    slug: job.slug,
    status: job.status,
    accepting: effectiveApplicationStatus(job, now) === 'OPEN',
    location: job.location?.displayName ?? null,
    workArrangement: job.workArrangement ?? null,
    publishedAt: job.publishedAt ? job.publishedAt.toISOString() : null,
    closesAt: job.closesAt ? job.closesAt.toISOString() : null,
    closedAt: job.closedAt ? job.closedAt.toISOString() : null,
    updatedAt: job.updatedAt ? job.updatedAt.toISOString() : null,
    applicationCount: applications,
  };
}

export function jobsAdminRouter({ clock = () => new Date(), audit, model = Job }) {
  const router = express.Router();
  const record = (req, action, jobId, metadata = {}) =>
    audit.record({ actor: { type: 'ADMIN', id: req.admin.id }, action, resource: { type: 'JOB', id: jobId }, requestId: req.id ?? null, metadata });

  async function loadJob(id) {
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const job = await model.findById(id);
    if (!job) throw notFound();
    return job;
  }

  router.get('/', requirePermission('jobs:read'), async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' && JOB_STATUSES.includes(req.query.status) ? req.query.status : null;
      const jobs = await model.find(status ? { status } : {}).sort({ updatedAt: -1 }).limit(200).lean();
      const counts = await Application.aggregate([{ $match: { jobId: { $in: jobs.map((j) => j._id) } } }, { $group: { _id: '$jobId', count: { $sum: 1 } } }]);
      const byJob = new Map(counts.map((c) => [String(c._id), c.count]));
      const now = clock();
      res.json(successEnvelope({ items: jobs.map((job) => toAdminJobSummary(job, { now, applications: byJob.get(String(job._id)) ?? 0 })) }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', requirePermission('jobs:read'), async (req, res, next) => {
    try {
      const job = await loadJob(req.params.id);
      const now = clock();
      res.json(
        successEnvelope(
          {
            job: { ...toAdminJobSummary(job, { now, applications: await applicationCount(job._id) }), content: canonicalJobContent(job) },
            publishProblems: checkPublishReadiness(job).missing,
            allowedActions: Object.entries(LIFECYCLE)
              .filter(([, rule]) => rule.from.includes(job.status) && req.admin.permissions.has(rule.permission))
              .map(([name]) => name),
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  /* Doc 12 s22-23 — a protected preview of the public presentation, without publishing. */
  router.get('/:id/preview', requirePermission('jobs:read'), async (req, res, next) => {
    try {
      const job = await loadJob(req.params.id);
      let preview;
      try {
        preview = toPublicJobDetail(job.toObject(), effectiveApplicationStatus(job, clock()));
      } catch {
        throw fail(409, 'PREVIEW_INCOMPLETE', 'The preview needs the required content first (title, location, arrangement, type, schedule, hours, pay, description, responsibilities and requirements).');
      }
      res.set('X-Robots-Tag', 'noindex, nofollow');
      res.json(successEnvelope({ preview }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/', requirePermission('jobs:create'), async (req, res, next) => {
    try {
      const definition = parseDefinition({ ...contentFromBody(req.body), slug: req.body?.slug, status: 'DRAFT', awaitingInput: [] });
      if (await model.exists({ slug: { $eq: definition.slug } })) throw fail(409, 'SLUG_TAKEN', 'A Job with this URL slug already exists.', [{ field: 'slug', code: 'SLUG_TAKEN', message: 'Choose another slug.' }]);
      const result = await provisionJob({ definition, apply: true, now: clock(), model });
      if (result.outcome !== 'created') throw outcomeError(result);
      const job = await model.findOne({ slug: { $eq: definition.slug } });
      await record(req, 'JOB_CREATED', job._id, { slug: job.slug });
      res.status(201).json(successEnvelope({ job: toAdminJobSummary(job, { now: clock(), applications: 0 }) }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', requirePermission('jobs:update'), async (req, res, next) => {
    try {
      const job = await loadJob(req.params.id);
      if (job.status === 'ARCHIVED') throw fail(409, 'JOB_ARCHIVED', 'An archived Job cannot be edited.');
      // The slug is the Job's identity here; it never changes through an edit (Doc 12 s40).
      const definition = parseDefinition({ ...contentFromBody(req.body), slug: job.slug, status: job.status, awaitingInput: [] });
      const result = await provisionJob({ definition, apply: true, now: clock(), confirmMaterialChange: req.body?.confirmMaterialChange === true, model });
      if (result.outcome === 'unchanged') return res.json(successEnvelope({ job: toAdminJobSummary(job, { now: clock(), applications: result.plan.applicationCount }), changed: [] }, req.id));
      if (result.outcome !== 'updated') throw outcomeError(result);
      await record(req, 'JOB_UPDATED', job._id, { fields: result.plan.changes, material: (result.plan.materialChanges ?? []).length > 0 });
      const fresh = await model.findById(job._id);
      res.json(successEnvelope({ job: toAdminJobSummary(fresh, { now: clock(), applications: result.plan.applicationCount }), changed: result.plan.changes }, req.id));
    } catch (error) {
      next(error);
    }
  });

  for (const [name, rule] of Object.entries(LIFECYCLE)) {
    router.post(`/:id/${name}`, requirePermission(rule.permission), async (req, res, next) => {
      try {
        const job = await loadJob(req.params.id);
        if (!rule.from.includes(job.status)) throw fail(409, 'TRANSITION_NOT_ALLOWED', `A ${job.status.toLowerCase()} Job cannot be moved to ${rule.to.toLowerCase()} this way.`);
        // Doc 12 s35: reopening needs a closing date that is absent or in the future.
        if (name === 'reopen' && job.closesAt && job.closesAt.getTime() <= clock().getTime()) {
          throw fail(409, 'CLOSING_DATE_PASSED', 'The closing date has passed. Update or clear it before reopening.');
        }
        const definition = parseDefinition({ ...canonicalJobContent(job), slug: job.slug, status: rule.to, awaitingInput: [] });
        // The Admin confirmed the action in the interface (Doc 12 s35); the request is that confirmation.
        const result = await provisionJob({ definition, apply: true, now: clock(), confirmLifecycle: true, model });
        if (result.outcome !== 'updated') throw outcomeError(result);
        await record(req, rule.action, job._id, { transition: `${job.status}->${rule.to}` });
        const fresh = await model.findById(job._id);
        res.json(successEnvelope({ job: toAdminJobSummary(fresh, { now: clock(), applications: await applicationCount(job._id) }) }, req.id));
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}
