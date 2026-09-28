import { createHash } from 'node:crypto';
import { Application, normalizeEmail } from '../../models/Application.js';

/**
 * Application construction helpers — Doc 10 sections 71-126.
 *
 * B2 provides only what is needed to build and validate a persisted
 * Application. The submission API, the idempotent replay workflow and real
 * resume storage belong to B5 and B4.
 */

/** Doc 10 sections 112, 114 — hashes, never the raw key or payload. */
const sha256Hex = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Hashes the client-supplied Idempotency-Key.
 *
 * The raw key is not retained (section 112): the stored hash is enough to
 * detect a duplicate, and keeping the original would preserve a client-chosen
 * value with no operational purpose.
 */
export function hashIdempotencyKey(key) {
  return sha256Hex(`idempotency:${key}`);
}

/** Stable text form: Unicode NFC, trimmed, internal whitespace runs collapsed. */
const canonicalText = (value) =>
  typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : null;

/**
 * Fingerprints the canonical logical submission content — Doc 10 sections
 * 114-116.
 *
 * Section 114 names the inputs, and every one of them is included:
 *   - jobId;
 *   - the normalised full name;
 *   - the normalised email;
 *   - the ENABLED optional candidate fields (phone, message) — callers pass
 *     null for a field the Job does not enable;
 *   - the normalised screening answers, ordered by questionId;
 *   - the resume checksum.
 *
 * So the same Idempotency-Key replayed with a different resume, message or
 * answer produces a different fingerprint and is a conflict (section 115),
 * not a silent replay of the earlier Application.
 *
 * Only the hash is stored; the canonical string is never persisted, so there
 * is no second copy of the candidate payload (section 116).
 */
export function buildRequestFingerprint({
  jobId,
  fullName,
  emailNormalized,
  phone = null,
  message = null,
  screeningAnswers = [],
  resumeChecksumSha256,
}) {
  const canonical = JSON.stringify({
    jobId: String(jobId),
    fullName: (canonicalText(fullName) ?? '').toLowerCase(),
    email: normalizeEmail(emailNormalized ?? ''),
    phone: canonicalText(phone) || null,
    // Newlines are meaningful in a message (Doc 09 section 86), so only line
    // endings are unified and the surrounding whitespace trimmed.
    message:
      typeof message === 'string' ? message.normalize('NFC').replace(/\r\n?/g, '\n').trim() || null : null,
    answers: [...screeningAnswers]
      .map((answer) => ({
        questionId: answer.questionId,
        textValue: typeof answer.textValue === 'string' ? answer.textValue.normalize('NFC').trim() : null,
        booleanValue: typeof answer.booleanValue === 'boolean' ? answer.booleanValue : null,
        optionId: answer.optionId ?? null,
      }))
      .sort((a, b) => String(a.questionId).localeCompare(String(b.questionId))),
    resumeChecksumSha256: String(resumeChecksumSha256 ?? '').toLowerCase(),
  });
  return sha256Hex(`fingerprint:${canonical}`);
}

/**
 * Captures the Job as the candidate saw it — Doc 10 sections 76-80.
 *
 * Taken once at submission and never refreshed: the live Job may change, and
 * the Application must keep recording what was actually applied to.
 * `location` is flattened to the public display string (section 79).
 */
export function buildJobSnapshot(job) {
  return {
    title: job.title,
    slug: job.slug,
    location: job.location?.displayName ?? null,
    workArrangement: job.workArrangement ?? null,
    employmentType: job.employmentType ?? null,
    schedule: job.schedule ?? null,
    weeklyHours: job.weeklyHours ?? null,
    compensation: {
      currency: job.compensation?.currency ?? null,
      amountMinor: job.compensation?.amountMinor ?? null,
      unit: job.compensation?.unit ?? null,
      gross: job.compensation?.gross ?? null,
    },
  };
}

/**
 * Snapshots a candidate's answer together with the question text and option
 * label as they read at submission (sections 89-93), so a later Job edit
 * cannot change what a historical Application appears to say.
 */
export function buildScreeningAnswer(question, rawValue) {
  const answer = {
    questionId: question.questionId,
    promptSnapshot: question.prompt,
    typeSnapshot: question.type,
    textValue: null,
    booleanValue: null,
    optionId: null,
    optionLabelSnapshot: null,
  };

  if (question.type === 'SHORT_TEXT' || question.type === 'LONG_TEXT') {
    answer.textValue = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  } else if (question.type === 'YES_NO') {
    answer.booleanValue = rawValue;
  } else if (question.type === 'SINGLE_SELECT') {
    const option = (question.options ?? []).find((candidate) => candidate.optionId === rawValue);
    answer.optionId = option?.optionId ?? null;
    answer.optionLabelSnapshot = option?.label ?? null;
  }

  return answer;
}

/**
 * Builds an Application document from controlled inputs.
 *
 * Every field is assigned explicitly. The caller cannot pass through arbitrary
 * keys, so an untrusted payload cannot set status, notification state or
 * retention — `strict: 'throw'` on the schema would reject unknown keys, and
 * this allowlist prevents known-but-privileged ones being set at all.
 */
export function buildApplication({
  job,
  candidate,
  screeningAnswers = [],
  resume,
  idempotencyKey,
  submittedAt = new Date(),
  candidateAcknowledgementEnabled = false,
}) {
  const emailNormalized = normalizeEmail(candidate.email);

  return new Application({
    jobId: job._id,
    jobSnapshot: buildJobSnapshot(job),
    candidate: {
      fullName: candidate.fullName,
      email: candidate.email,
      emailNormalized,
      phone: candidate.phone ?? null,
      message: candidate.message ?? null,
    },
    // Each answer is copied field by field, so an untrusted object cannot carry
    // extra keys into the document.
    screeningAnswers: screeningAnswers.map((answer) => ({
      questionId: answer.questionId,
      promptSnapshot: answer.promptSnapshot,
      typeSnapshot: answer.typeSnapshot,
      textValue: answer.textValue ?? null,
      booleanValue: answer.booleanValue ?? null,
      optionId: answer.optionId ?? null,
      optionLabelSnapshot: answer.optionLabelSnapshot ?? null,
    })),
    resume: {
      storageProvider: resume.storageProvider,
      storageKey: resume.storageKey,
      originalFilename: resume.originalFilename,
      extension: resume.extension,
      mimeType: resume.mimeType,
      sizeBytes: resume.sizeBytes,
      checksumSha256: resume.checksumSha256,
      /*
       * Doc 10 section 105 — NOT_SCANNED unless a real scan already ran.
       * B4 owns storage and B2 owns no scanner, so nothing here may claim the
       * file is CLEAN.
       */
      scanStatus: resume.scanStatus ?? 'NOT_SCANNED',
      scanCheckedAt: resume.scanCheckedAt ?? null,
      // Supplied by the storage step (B4); required, never invented here.
      storedAt: resume.storedAt,
    },
    status: 'RECEIVED',
    idempotency: {
      keyHash: hashIdempotencyKey(idempotencyKey),
      requestFingerprintHash: buildRequestFingerprint({
        jobId: job._id,
        fullName: candidate.fullName,
        emailNormalized,
        phone: candidate.phone ?? null,
        message: candidate.message ?? null,
        screeningAnswers,
        resumeChecksumSha256: resume.checksumSha256,
      }),
    },
    notifications: {
      // Sections 120-121 — PENDING means "not yet attempted", never SENT.
      internal: { status: 'PENDING', attemptCount: 0 },
      candidateAcknowledgement: {
        status: candidateAcknowledgementEnabled ? 'PENDING' : 'NOT_REQUIRED',
        attemptCount: 0,
      },
    },
    submittedAt,
    // Sections 125-126 — structure present, values null until a real policy exists.
    retention: { policyVersion: null, retainUntil: null },
  });
}

export { Application };
