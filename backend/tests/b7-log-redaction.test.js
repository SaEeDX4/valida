import { describe, it, expect, afterEach } from 'vitest';
import { createApplyEnvironment, applyRequest } from './fixtures/applyHarness.js';
import { PDF_MIME, syntheticPdf } from './fixtures/resumeFiles.js';

/**
 * B7 — log redaction (Doc 13 section 281; Doc 09 sections 149-150): known
 * synthetic markers in every candidate field and in the resume filename never
 * appear in the production-style logs — on success, on a validation failure and
 * on a storage failure. (Notification content is covered by T-07.)
 */
const MARK = Object.freeze({
  fullName: 'Qzb7name Markerson',
  email: 'qzb7mail.marker@privacy-marker.example.invalid',
  phone: '+1 (555) 010-0177',
  message: 'QZB7MSG message marker',
  filename: 'qzb7file-marker.pdf',
});
let env;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

function expectNoMarkerInLogs() {
  const output = env.log.output();
  expect(output.length).toBeGreaterThan(0);
  for (const value of [MARK.fullName, 'Qzb7name', 'Markerson', MARK.email, 'qzb7mail', MARK.phone, '010-0177', MARK.message, 'QZB7MSG', MARK.filename, 'qzb7file']) {
    expect(output, value).not.toContain(value);
  }
}

const markedRequest = (app, overrides = {}) =>
  applyRequest(app, {
    fields: { fullName: MARK.fullName, email: MARK.email, phone: MARK.phone, message: MARK.message, ...overrides },
    resume: { data: syntheticPdf(), filename: MARK.filename, contentType: PDF_MIME },
  });

describe('no candidate data in the logs', () => {
  it('on a successful Apply (201)', async () => {
    env = await createApplyEnvironment();
    const response = await markedRequest(env.app);
    expect(response.status).toBe(201);
    expectNoMarkerInLogs();
  });

  it('on a validation failure (422)', async () => {
    env = await createApplyEnvironment();
    const response = await markedRequest(env.app, { email: `${MARK.email}@@` });
    expect(response.status).toBe(422);
    expectNoMarkerInLogs();
  });

  it('when private storage fails (503)', async () => {
    env = await createApplyEnvironment({
      storageOptions: { operations: { rename: async () => { throw Object.assign(new Error('qa'), { code: 'EIO' }); } } },
    });
    const response = await markedRequest(env.app);
    expect(response.status).toBe(503);
    expectNoMarkerInLogs();
  });
});
