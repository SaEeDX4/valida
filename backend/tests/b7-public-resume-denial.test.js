import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApplyEnvironment, applyRequest } from './fixtures/applyHarness.js';

/**
 * B7 — public resume denial (Doc 13 sections 68-69, 278-279; Doc 17 sections
 * 125-126; threat T03): after a real Apply through the app, the stored resume
 * is reachable by no HTTP path — not by its storage key, its object path or
 * any upload/static-looking route — and no response carries the key.
 */
let env;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

describe('a stored resume is never served over HTTP', () => {
  it('no route returns the object, and neither the Apply answer nor the replay carries its storage key', async () => {
    env = await createApplyEnvironment();
    const key = 'b7-qa-0000-4000-8000-000000000001';
    const created = await applyRequest(env.app, { key });
    expect(created.status).toBe(201);
    const [stored] = env.storedObjects();
    expect(stored).toBeTypeOf('string');
    const [id, fileKey] = stored.split(/[\\/]/).slice(-2); // <root>/resumes/<id>/<fileKey>
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(fileKey).toMatch(/^[0-9a-f]{32}$/);
    const relative = `resumes/${id}/${fileKey}`;

    const replay = await applyRequest(env.app, { key });
    for (const answer of [created, replay]) {
      for (const secret of [relative, id, fileKey]) expect(answer.text).not.toContain(secret);
    }

    const probes = [
      `/${relative}`,
      `/api/v1/${relative}`,
      `/api/v1/storage/${relative}`,
      `/api/v1/resumes/${id}/${fileKey}`,
      `/uploads/${fileKey}`,
      `/static/${relative}`,
      `/api/v1/jobs/qa-synthetic-apply-role/applications/${id}/resume`,
      `/api/v1/../${relative}`,
      `/api/v1/%2e%2e/${relative}`,
    ];
    for (const probe of probes) {
      const response = await request(env.app).get(probe);
      expect(response.status, probe).toBe(404);
      expect(response.text, probe).not.toContain('%PDF');
      expect(response.headers['content-type'] ?? '', probe).not.toMatch(/application\/pdf/);
    }
  });
});
