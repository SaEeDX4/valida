// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { matchRoute, renderDocument } from './renderDocument.js';

/**
 * E2 — the Admin application shell from the document server (Doc 11 s128,
 * s249, s254; Doc 12 s23). One document for every /admin path; never indexed,
 * never stored, never leaks a referrer (activation and reset tokens live in
 * the URL fragment).
 */

const TEMPLATE = '<!doctype html><html><head><title>Valida</title><!--valida:head--></head><body><div id="root"></div></body></html>';
const noJobs = { getJob: () => { throw new Error('the Admin shell must not read Jobs'); } };

describe('the /admin document', () => {
  it.each(['/admin', '/admin/login', '/admin/applications/0123456789abcdef01234567', '/admin/activate'])('serves %s as the Admin shell', async (path) => {
    expect(matchRoute(path)).toEqual({ kind: 'admin' });
    const doc = await renderDocument(path, { template: TEMPLATE, config: { indexing: true, siteOrigin: 'https://cybervalida.com' }, jobs: noJobs });
    expect(doc.status).toBe(200);
    expect(doc.headers['cache-control']).toBe('private, no-store');
    expect(doc.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(doc.headers['referrer-policy']).toBe('no-referrer');
    expect(doc.body).toContain('<title>Valida Admin</title>');
    expect(doc.body).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  });

  it('does not capture look-alike public paths', () => {
    expect(matchRoute('/administrator')).toEqual({ kind: 'notFound' });
    expect(matchRoute('/careers/admin')).toEqual({ kind: 'job', slug: 'admin' });
  });
});
