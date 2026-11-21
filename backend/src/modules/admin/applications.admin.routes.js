import { randomUUID } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError, ERROR_CODES } from '../../errors/AppError.js';
import { successEnvelope } from '../../lib/envelope.js';
import { Admin } from '../../models/Admin.js';
import { Application, APPLICATION_STATUSES, COMMUNICATION_DIRECTIONS, COMMUNICATION_KINDS } from '../../models/Application.js';
import { Job } from '../../models/Job.js';
import { retrieveResumeForReview } from '../applications/resume/resumeSecurity.js';
import { allowedNextStatuses, checkTransition } from './applicationStatus.rules.js';
import { requirePermission } from './session.js';

/**
 * /api/v1/admin/applications — E4 application management and secure résumé
 * review, E5 status / notes / communications (Doc 12 s67-114, s149-165;
 * Doc 11 s161-179).
 *
 * - Search is built server-side from plain text; browser input never becomes a
 *   query operator or a regular expression (Doc 12 s152).
 * - The private storage key is never returned (Doc 11 s168, Doc 12 s159).
 * - A résumé is released only when its scan status is CLEAN, after the audit
 *   event is written (retrieveResumeForReview; Doc 11 s166, s172-177).
 * - A status change names the status it expects to replace; if another Admin
 *   changed it meanwhile the save matches nothing and the request is refused
 *   (STATUS_CONFLICT) — a stale decision never overwrites a newer one (E5 s245).
 */

const fail = (status, code, message, fieldErrors) => new AppError({ status, code, message, ...(fieldErrors ? { fieldErrors } : {}) });
const notFound = () => fail(404, 'APPLICATION_NOT_FOUND', 'That Application was not found.');

function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  throw new AppError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: 'Some fields need attention.',
    fieldErrors: result.error.issues.map((issue) => ({ field: String(issue.path[0] ?? 'body'), code: 'INVALID', message: issue.message })),
  });
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (date) => (date instanceof Date ? date.toISOString() : null);

async function adminNames(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const admins = await Admin.find({ _id: { $in: unique } }, { displayName: 1 }).lean();
  return new Map(admins.map((a) => [String(a._id), a.displayName]));
}

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().trim().max(120).optional(),
  jobId: z.string().regex(/^[0-9a-f]{24}$/).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/**
 * Appends to an Application, reloading and retrying (bounded) if a concurrent
 * write to the same record won the race; append-only entries never collide.
 */
async function appendWithRetry(load, mutate, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    const doc = await load();
    mutate(doc);
    try {
      await doc.save();
      return doc;
    } catch (error) {
      if (!(error instanceof mongoose.Error.VersionError) || attempt >= attempts) throw error;
    }
  }
}

export function applicationsAdminRouter({ clock = () => new Date(), audit, resumeStorage, model = Application }) {
  const router = express.Router();
  const record = (req, action, applicationId, metadata = {}) =>
    audit.record({ actor: { type: 'ADMIN', id: req.admin.id }, action, resource: { type: 'APPLICATION', id: applicationId }, requestId: req.id ?? null, metadata });

  async function loadApplication(id) {
    if (!mongoose.isValidObjectId(id) || !/^[0-9a-f]{24}$/.test(String(id))) throw notFound();
    const application = await model.findById(id);
    if (!application) throw notFound();
    return application;
  }

  // --------------------------------------------------------- s149-155 list --
  router.get('/', requirePermission('applications:read'), async (req, res, next) => {
    try {
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) throw fail(400, ERROR_CODES.VALIDATION_FAILED, 'The filters are not valid.');
      const { page, limit, q, jobId, status, from, to } = parsed.data;
      const filter = {};
      if (jobId) filter.jobId = new mongoose.Types.ObjectId(jobId);
      if (status) filter.status = status;
      if (from || to) {
        filter.submittedAt = {};
        if (from) filter.submittedAt.$gte = new Date(`${from}T00:00:00.000Z`);
        if (to) filter.submittedAt.$lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000);
      }
      if (q) {
        const text = escapeRegex(q);
        filter.$or = [{ 'candidate.fullName': { $regex: text, $options: 'i' } }, { 'candidate.emailNormalized': { $regex: `^${escapeRegex(q.toLowerCase())}` } }];
      }
      const [total, docs] = await Promise.all([
        model.countDocuments(filter),
        model
          .find(filter, { 'candidate.fullName': 1, 'candidate.email': 1, 'candidate.emailNormalized': 1, jobId: 1, 'jobSnapshot.title': 1, status: 1, submittedAt: 1, 'resume.scanStatus': 1 })
          .sort({ submittedAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      // Doc 12 s67-68 — a non-blocking duplicate indicator: same email, same Job.
      const pairs = docs.map((d) => ({ 'candidate.emailNormalized': d.candidate.emailNormalized, jobId: d.jobId }));
      const dupCounts = pairs.length
        ? await model.aggregate([{ $match: { $or: pairs } }, { $group: { _id: { e: '$candidate.emailNormalized', j: '$jobId' }, n: { $sum: 1 } } }])
        : [];
      const dup = new Map(dupCounts.map((c) => [`${c._id.e}|${c._id.j}`, c.n]));
      res.json(
        successEnvelope(
          {
            items: docs.map((d) => ({
              id: String(d._id),
              candidateName: d.candidate.fullName,
              candidateEmail: d.candidate.email,
              job: { id: String(d.jobId), title: d.jobSnapshot.title },
              status: d.status,
              submittedAt: iso(d.submittedAt),
              resumeScanStatus: d.resume.scanStatus,
              possibleDuplicate: (dup.get(`${d.candidate.emailNormalized}|${d.jobId}`) ?? 1) > 1,
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------- s156-165 detail --
  router.get('/:id', requirePermission('applications:read'), async (req, res, next) => {
    try {
      const app = await loadApplication(req.params.id);
      const a = app.toObject();
      const job = await Job.findById(a.jobId, { title: 1, slug: 1, status: 1, location: 1, workArrangement: 1, employmentType: 1, weeklyHours: 1, compensation: 1 }).lean();
      const history = a.statusHistory?.length
        ? a.statusHistory
        : [{ entryId: null, fromStatus: null, toStatus: 'RECEIVED', changedByAdminId: null, changedAt: a.submittedAt, reason: null }];
      const names = await adminNames([...history.map((h) => h.changedByAdminId), ...(a.notes ?? []).map((n) => n.authorAdminId), ...(a.communications ?? []).map((c) => c.actorAdminId)]);
      const duplicates = await model
        .find({ _id: { $ne: a._id }, 'candidate.emailNormalized': a.candidate.emailNormalized, jobId: a.jobId }, { _id: 1, submittedAt: 1, status: 1 })
        .sort({ submittedAt: -1 })
        .limit(10)
        .lean();
      const snapshot = a.jobSnapshot;
      const jobChanged = job
        ? job.title !== snapshot.title || (job.location?.displayName ?? null) !== snapshot.location || job.workArrangement !== snapshot.workArrangement || job.weeklyHours !== snapshot.weeklyHours || job.compensation?.amountMinor !== snapshot.compensation?.amountMinor
        : true;
      const ack = a.notifications?.candidateAcknowledgement;
      const automated = ack && ack.status !== 'NOT_REQUIRED'
        ? [{ communicationId: null, channel: 'EMAIL', direction: 'OUTBOUND', kind: 'APPLICATION_ACKNOWLEDGEMENT', status: ack.status, subject: null, summary: 'Automated acknowledgement', actorType: 'SYSTEM', actorName: 'Valida', occurredAt: iso(ack.sentAt ?? ack.lastAttemptAt) }]
        : [];
      res.json(
        successEnvelope(
          {
            application: {
              id: String(a._id),
              status: a.status,
              submittedAt: iso(a.submittedAt),
              candidate: { fullName: a.candidate.fullName, email: a.candidate.email, phone: a.candidate.phone ?? null, message: a.candidate.message ?? null },
              screeningAnswers: (a.screeningAnswers ?? []).map((s) => ({
                prompt: s.promptSnapshot,
                type: s.typeSnapshot,
                answer: s.typeSnapshot === 'YES_NO' ? (s.booleanValue ? 'Yes' : 'No') : s.typeSnapshot === 'SINGLE_SELECT' ? s.optionLabelSnapshot : s.textValue,
              })),
              appliedRole: snapshot,
              currentJob: job ? { id: String(job._id), title: job.title, slug: job.slug, status: job.status, changedSinceApplication: jobChanged } : null,
              resume: {
                originalFilename: a.resume.originalFilename,
                extension: a.resume.extension,
                mimeType: a.resume.mimeType,
                sizeBytes: a.resume.sizeBytes,
                scanStatus: a.resume.scanStatus,
                scanCheckedAt: iso(a.resume.scanCheckedAt),
                available: a.resume.scanStatus === 'CLEAN' && req.admin.permissions.has('applications:resume:read'),
              },
              statusHistory: history.map((h) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, changedAt: iso(h.changedAt), changedBy: h.changedByAdminId ? names.get(String(h.changedByAdminId)) ?? 'Former Admin' : 'System', reason: h.reason ?? null })),
              notes: (a.notes ?? []).map((n) => ({ id: n.noteId, body: n.body, createdAt: iso(n.createdAt), author: names.get(String(n.authorAdminId)) ?? 'Former Admin' })),
              communications: [
                ...automated,
                ...(a.communications ?? []).map((c) => ({ ...c, actorAdminId: undefined, actorName: c.actorAdminId ? names.get(String(c.actorAdminId)) ?? 'Former Admin' : 'Valida', occurredAt: iso(c.occurredAt) })),
              ].sort((x, y) => String(y.occurredAt).localeCompare(String(x.occurredAt))),
              internalNotification: a.notifications?.internal?.status ?? null,
              duplicates: duplicates.map((d) => ({ id: String(d._id), submittedAt: iso(d.submittedAt), status: d.status })),
            },
            allowedNextStatuses: req.admin.permissions.has('applications:status:update') ? allowedNextStatuses(a.status, req.admin.roles) : [],
            permissions: {
              updateStatus: req.admin.permissions.has('applications:status:update'),
              writeNotes: req.admin.permissions.has('applications:notes:write'),
              recordCommunication: req.admin.permissions.has('applications:communication'),
              readResume: req.admin.permissions.has('applications:resume:read'),
            },
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------- s172-177 résumé access --
  router.get('/:id/resume', requirePermission('applications:resume:read'), async (req, res, next) => {
    try {
      if (!resumeStorage) throw fail(503, 'RESUME_STORAGE_UNAVAILABLE', 'Résumé storage is not available.');
      const result = await retrieveResumeForReview({
        applications: model.collection,
        storage: resumeStorage,
        applicationId: req.params.id,
        audit: ({ applicationId }) => record(req, 'RESUME_ACCESSED', applicationId, {}),
      });
      if (!result.released) {
        if (result.reason === 'NOT_FOUND') throw notFound();
        if (result.reason === 'NOT_RELEASABLE') throw fail(409, 'RESUME_NOT_AVAILABLE', 'This résumé has not passed the security scan and cannot be opened.', [{ field: 'scanStatus', code: result.scanStatus, message: result.scanStatus }]);
        throw fail(503, 'RESUME_UNAVAILABLE', 'The résumé could not be retrieved.');
      }
      const ascii = result.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      res.set(result.headers);
      res.set('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
      res.set('Content-Length', String(result.bytes.length));
      res.status(200).end(result.bytes);
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------- s88-95 status change --
  const statusSchema = z.object({ fromStatus: z.enum(APPLICATION_STATUSES), toStatus: z.enum(APPLICATION_STATUSES), reason: z.string().trim().max(1000).optional() }).strict();
  router.post('/:id/status', requirePermission('applications:status:update'), async (req, res, next) => {
    try {
      const { fromStatus, toStatus, reason } = parseBody(statusSchema, req.body);
      const app = await loadApplication(req.params.id);
      if (app.status !== fromStatus) throw fail(409, 'STATUS_CONFLICT', 'This Application changed since you opened it. Reload to see its current status.');
      const decision = checkTransition({ from: fromStatus, to: toStatus, roles: req.admin.roles, reason });
      if (!decision.allowed) throw fail(decision.code === 'CORRECTION_REQUIRES_OWNER' ? 403 : 400, decision.code, decision.message);
      if (app.statusHistory.length === 0) {
        // A record saved before E5: its initial, system-made entry first (Doc 12 s95).
        app.statusHistory.push({ entryId: randomUUID(), fromStatus: null, toStatus: 'RECEIVED', changedByAdminId: null, changedAt: app.submittedAt, reason: null });
      }
      app.statusHistory.push({ entryId: randomUUID(), fromStatus, toStatus, changedByAdminId: req.admin.id, changedAt: clock(), reason: reason?.length ? reason : null });
      app.status = toStatus;
      app.$where = { status: fromStatus };
      try {
        await app.save();
      } catch (error) {
        // A lost race surfaces as DocumentNotFoundError or, with array versioning, VersionError: either way, refused.
        if (error instanceof mongoose.Error.DocumentNotFoundError || error instanceof mongoose.Error.VersionError) throw fail(409, 'STATUS_CONFLICT', 'This Application changed since you opened it. Reload to see its current status.');
        throw error;
      }
      await record(req, 'APPLICATION_STATUS_CHANGED', app._id, { fromStatus, toStatus, reasonProvided: Boolean(reason?.length) });
      res.json(successEnvelope({ status: toStatus, allowedNextStatuses: allowedNextStatuses(toStatus, req.admin.roles) }, req.id));
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------------- s96-103 notes --
  router.post('/:id/notes', requirePermission('applications:notes:write'), async (req, res, next) => {
    try {
      const { body } = parseBody(z.object({ body: z.string().trim().min(1).max(5000) }).strict(), req.body);
      const note = { noteId: randomUUID(), authorAdminId: req.admin.id, body, createdAt: clock() };
      const app = await appendWithRetry(() => loadApplication(req.params.id), (doc) => doc.notes.push(note));
      await record(req, 'APPLICATION_NOTE_ADDED', app._id, {}); // never the note body (s103)
      res.status(201).json(successEnvelope({ note: { id: note.noteId, body, createdAt: note.createdAt.toISOString(), author: req.admin.displayName } }, req.id));
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------- s104-121 communications --
  const communicationSchema = z
    .object({
      kind: z.enum(COMMUNICATION_KINDS),
      direction: z.enum(COMMUNICATION_DIRECTIONS),
      subject: z.string().trim().max(300).optional(),
      summary: z.string().trim().max(1000).optional(),
      occurredAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict();
  router.post('/:id/communications', requirePermission('applications:communication'), async (req, res, next) => {
    try {
      const input = parseBody(communicationSchema, req.body);
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : clock();
      if (occurredAt.getTime() > clock().getTime() + 5 * 60_000) throw fail(400, ERROR_CODES.VALIDATION_FAILED, 'A communication cannot be recorded in the future.', [{ field: 'occurredAt', code: 'IN_FUTURE', message: 'Choose a time that has passed.' }]);
      // Phase 3: the message itself goes through the careers@ mailbox; Valida records its context (s111, s120-121).
      const entry = {
        communicationId: randomUUID(),
        channel: 'EMAIL',
        direction: input.direction,
        kind: input.kind,
        status: 'RECORDED_EXTERNAL',
        subject: input.subject?.length ? input.subject : null,
        summary: input.summary?.length ? input.summary : null,
        actorType: 'ADMIN',
        actorAdminId: req.admin.id,
        occurredAt,
        providerReference: null,
      };
      const app = await appendWithRetry(() => loadApplication(req.params.id), (doc) => doc.communications.push(entry));
      await record(req, 'APPLICATION_COMMUNICATION_RECORDED', app._id, { kind: input.kind, direction: input.direction, channel: 'EMAIL' });
      res.status(201).json(successEnvelope({ communication: { ...entry, actorAdminId: undefined, actorName: req.admin.displayName, occurredAt: occurredAt.toISOString() } }, req.id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/** Doc 12 s142-143 — the Overview holds only real recruitment numbers. */
export function overviewRouter({ clock = () => new Date() }) {
  const router = express.Router();
  router.get('/', requirePermission('applications:read'), requirePermission('jobs:read'), async (req, res, next) => {
    try {
      const now = clock();
      const [jobsByStatus, openJobs, byStatus, awaitingScan, total] = await Promise.all([
        Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        Job.countDocuments({ status: 'PUBLISHED', publishedAt: { $lte: now }, $or: [{ closesAt: null }, { closesAt: { $gt: now } }] }),
        Application.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        Application.countDocuments({ 'resume.scanStatus': { $in: ['NOT_SCANNED', 'PENDING', 'FAILED'] } }),
        Application.estimatedDocumentCount(),
      ]);
      const statusCounts = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
      res.json(
        successEnvelope(
          {
            jobs: { accepting: openJobs, byStatus: Object.fromEntries(jobsByStatus.map((s) => [s._id, s.n])) },
            applications: { total, awaitingReview: statusCounts.RECEIVED ?? 0, byStatus: statusCounts, resumesAwaitingScan: awaitingScan },
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  return router;
}

/** Doc 11 s198-202 — the owner's audit view (audit:read). Read-only. */
export function auditRouter() {
  const router = express.Router();
  const query = z.object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    resourceType: z.enum(['ADMIN', 'JOB', 'APPLICATION', 'SESSION']).optional(),
    resourceId: z.string().regex(/^[0-9a-f]{24}$/).optional(),
    action: z.string().regex(/^[A-Z_]{3,64}$/).optional(),
  });
  router.get('/', requirePermission('audit:read'), async (req, res, next) => {
    try {
      const parsed = query.safeParse(req.query);
      if (!parsed.success) throw fail(400, ERROR_CODES.VALIDATION_FAILED, 'The filters are not valid.');
      const { page, limit, resourceType, resourceId, action } = parsed.data;
      const filter = {};
      if (resourceType) filter['resource.type'] = resourceType;
      if (resourceId) filter['resource.id'] = new mongoose.Types.ObjectId(resourceId);
      if (action) filter.action = action;
      const collection = mongoose.connection.collection('audit_events');
      const [total, events] = await Promise.all([
        collection.countDocuments(filter),
        collection.find(filter).sort({ occurredAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      ]);
      const names = await adminNames(events.map((e) => e.actor?.id));
      res.json(
        successEnvelope(
          {
            items: events.map((e) => ({
              id: String(e._id),
              action: e.action,
              actor: e.actor?.type === 'ADMIN' ? names.get(String(e.actor.id)) ?? 'Former Admin' : 'System',
              resource: { type: e.resource.type, id: e.resource.id ? String(e.resource.id) : null },
              metadata: e.metadata ?? {},
              requestId: e.requestId ?? null,
              occurredAt: iso(e.occurredAt),
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  return router;
}
