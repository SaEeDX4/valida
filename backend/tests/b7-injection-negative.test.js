import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { buildConnectedApp } from './helpers.js';
import { QA_NOW, at, minutes, storedJob } from './fixtures/jobFixtures.js';
import { QA_TEXT_QUESTION_ID, applyRequest, createApplyEnvironment, qaAnswers } from './fixtures/applyHarness.js';

/**
 * B7 — controlled NoSQL-operator payloads (Doc 13 sections 44-46, 272; Doc 17
 * section 132; Doc 18 section 141). The existing suites already send `$ne` and
 * `$gt` (jobs-validation, jobs-http, apply-validation-http, db/jobs-api); this
 * file adds `$where` to every public input surface and states the expected
 * outcome once per surface: refused before any data-layer call, or kept as
 * ordinary text — never an operator.
 */
const OPERATORS = ['$ne', '$gt', '$where'];

function recordingRepository() {
  const calls = [];
  return {
    calls,
    async listOpenJobs(args) {
      calls.push(['list', args]);
      return { total: 0, jobs: [] };
    },
    async findPublicJobBySlug(args) {
      calls.push(['detail', args]);
      return storedJob({ publishedAt: at(-minutes(60)), closesAt: null });
    },
  };
}

describe('Jobs API: operator-shaped query input never reaches the data layer', () => {
  const lists = OPERATORS.flatMap((op) => [`?page[${op}]=1`, `?limit[${op}]=0`, `?${op}=1`, `?page=1&${encodeURIComponent(op)}=x`]);

  it.each(lists)('GET /api/v1/jobs%s is 422 with no lookup', async (query) => {
    const repository = recordingRepository();
    const response = await request(buildConnectedApp({ jobRepository: repository, clock: () => QA_NOW })).get(`/api/v1/jobs${query}`);
    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('$');
    expect(repository.calls).toEqual([]);
  });

  it.each(OPERATORS.map((op) => encodeURIComponent(JSON.stringify({ [op]: null }))))('GET /api/v1/jobs/%s is 404 with no lookup', async (slug) => {
    const repository = recordingRepository();
    const response = await request(buildConnectedApp({ jobRepository: repository, clock: () => QA_NOW })).get(`/api/v1/jobs/${slug}`);
    expect(response.status).toBe(404);
    expect(repository.calls).toEqual([]);
  });
});

describe('Apply API: operator-shaped candidate input', () => {
  let env;
  afterEach(async () => {
    await env?.cleanup();
    env = undefined;
  });
  const expectNothingKept = () => {
    expect(env.applications.all()).toEqual([]);
    expect(env.storedObjects()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
  };

  it.each(OPERATORS.flatMap((op) => [op, `email[${op}]`, `fullName.${op}`]))('a multipart field named %s is 422 UNSUPPORTED_FIELD; nothing is created', async (name) => {
    env = await createApplyEnvironment();
    const response = await applyRequest(env.app, { fields: { [name]: 'x' } });
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([{ field: 'form', code: 'UNSUPPORTED_FIELD', message: "This form contains information that isn't accepted." }]);
    expectNothingKept();
  });

  it.each(OPERATORS)('a screening answer that is a %s object is 422 INVALID_SCREENING_ANSWERS; nothing is created', async (op) => {
    env = await createApplyEnvironment();
    const answers = qaAnswers();
    answers[0] = { ...answers[0], answer: { [op]: op === '$where' ? 'sleep(1000)' : null } };
    const response = await applyRequest(env.app, { answers: JSON.stringify(answers) });
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([{ field: 'screeningAnswers', code: 'INVALID_SCREENING_ANSWERS', message: "This form contains information that isn't accepted." }]);
    expectNothingKept();
  });

  it('operator-shaped TEXT in candidate fields is stored as ordinary text, byte for byte', async () => {
    env = await createApplyEnvironment();
    const text = '{"$where": "sleep(1000)"} {"$ne": null} {"$gt": ""}';
    const answers = qaAnswers().map((entry) => (entry.questionId === QA_TEXT_QUESTION_ID ? { ...entry, answer: text } : entry));
    const response = await applyRequest(env.app, { fields: { fullName: 'QA $where Candidate', message: text }, answers: JSON.stringify(answers) });
    expect(response.status).toBe(201);
    const [record] = env.applications.all();
    expect(record.candidate.fullName).toBe('QA $where Candidate');
    expect(record.candidate.message).toBe(text);
    expect(record.screeningAnswers.find((entry) => entry.questionId === QA_TEXT_QUESTION_ID).textValue).toBe(text);
  });
});
