import { describe, it, expect } from 'vitest';
import { assessSnapshots, checkFreshness } from '../scripts/atlas-snapshot-freshness.mjs';

/**
 * Proposed (MongoDB-native) — OFFLINE: the snapshot-freshness check that is the
 * backup alert for Atlas Flex. The Atlas API is a local stub; whether the real
 * API answers this shape for a Project Read Only service account is a Review
 * check (decision sheet). Synthetic values only.
 */
const NOW = new Date('2026-11-18T12:00:00Z');
const snap = (status, finishTime, scheduledTime = finishTime) => ({ status, finishTime, scheduledTime });
const ENV = { ATLAS_CLIENT_ID: 'mdb_sa_id_qa', ATLAS_CLIENT_SECRET: 'qa-unit-secret', ATLAS_GROUP_ID: 'a'.repeat(24), ATLAS_FLEX_CLUSTER: 'valida-qa' };

function stubFetch(results, { tokenStatus = 200, listStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/oauth/token')) return { ok: tokenStatus === 200, status: tokenStatus, json: async () => ({ access_token: 'qa-bearer' }) };
    return { ok: listStatus === 200, status: listStatus, json: async () => ({ results }) };
  };
  return { fetchImpl, calls };
}

describe('assessSnapshots', () => {
  it('FRESH when the newest completed snapshot is within the limit', () => {
    expect(assessSnapshots([snap('COMPLETED', '2026-11-18T03:00:00Z'), snap('COMPLETED', '2026-11-17T03:00:00Z')], { now: NOW })).toMatchObject({ verdict: 'FRESH', completed: 2, ageHours: 9 });
  });
  it('STALE when the newest completed snapshot is older than the limit (a backup that silently stopped)', () => {
    expect(assessSnapshots([snap('COMPLETED', '2026-11-17T08:00:00Z')], { now: NOW })).toMatchObject({ verdict: 'STALE', ageHours: 28 });
  });
  it('FAILED_SNAPSHOT when a snapshot after the newest completed one failed', () => {
    expect(assessSnapshots([snap('COMPLETED', '2026-11-18T03:00:00Z'), snap('FAILED', null, '2026-11-18T10:00:00Z')], { now: NOW }).verdict).toBe('FAILED_SNAPSHOT');
  });
  it('NO_SNAPSHOT when nothing has completed; pending and running do not count', () => {
    expect(assessSnapshots([snap('RUNNING', null, '2026-11-18T11:00:00Z')], { now: NOW }).verdict).toBe('NO_SNAPSHOT');
    expect(assessSnapshots([], { now: NOW }).verdict).toBe('NO_SNAPSHOT');
  });
});

describe('checkFreshness against a stubbed Atlas API', () => {
  it('uses a bearer token from the service account and the versioned Flex snapshots path; prints no credential', async () => {
    const { fetchImpl, calls } = stubFetch([snap('COMPLETED', '2026-11-18T03:00:00Z')]);
    const result = await checkFreshness({ env: ENV, fetchImpl, now: NOW });
    expect(result.verdict).toBe('FRESH');
    expect(calls[1].url).toBe(`https://cloud.mongodb.com/api/atlas/v2/groups/${'a'.repeat(24)}/flexClusters/valida-qa/backup/snapshots?itemsPerPage=100`);
    expect(calls[1].init.headers.accept).toBe('application/vnd.atlas.2025-03-12+json');
    expect(JSON.stringify(result)).not.toMatch(/qa-unit-secret|qa-bearer|mdb_sa_id_qa/);
  });
  it('UNAVAILABLE (a failure, not a pass) when the token or the list is refused', async () => {
    expect((await checkFreshness({ env: ENV, fetchImpl: stubFetch([], { tokenStatus: 401 }).fetchImpl, now: NOW })).verdict).toBe('UNAVAILABLE');
    expect((await checkFreshness({ env: ENV, fetchImpl: stubFetch([], { listStatus: 403 }).fetchImpl, now: NOW })).verdict).toBe('UNAVAILABLE');
  });
  it('refuses missing or malformed settings, naming the variable only', async () => {
    expect((await checkFreshness({ env: { ...ENV, ATLAS_CLIENT_SECRET: '' } })).refused).toBe('ATLAS_CLIENT_SECRET is required');
    expect((await checkFreshness({ env: { ...ENV, ATLAS_GROUP_ID: 'x' } })).refused).toMatch(/ATLAS_GROUP_ID/);
  });
});
