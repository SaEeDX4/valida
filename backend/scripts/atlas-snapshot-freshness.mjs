#!/usr/bin/env node
/**
 * Proposed (MongoDB-native launch change) — backup monitoring for an Atlas Flex
 * cluster (Doc 15 section 187: "a configured backup that silently stopped is
 * not adequate"). Flex has no backup alert of its own (its alerts are limited
 * to connections, logical size, network and opcounters), so this check is the
 * alert: it fails when the newest COMPLETED snapshot is older than the limit,
 * or when a snapshot newer than it FAILED. Run daily by
 * .github/workflows/backup-freshness.yml; a failed run notifies the owner.
 *
 *   ATLAS_CLIENT_ID / ATLAS_CLIENT_SECRET  a service account with Project Read Only
 *                                          (the role the list operation requires);
 *                                          it cannot change or delete a snapshot
 *   ATLAS_GROUP_ID, ATLAS_FLEX_CLUSTER     the project id and cluster name
 *   ATLAS_SNAPSHOT_MAX_AGE_HOURS           optional, default 26 (daily snapshot + margin)
 *
 * Prints one JSON line (times, counts, statuses — never a credential). Exit:
 * 0 FRESH, 1 STALE / FAILED_SNAPSHOT / NO_SNAPSHOT / UNAVAILABLE, 2 refused.
 */
const API = process.env.ATLAS_API_BASE ?? 'https://cloud.mongodb.com';
const ACCEPT = 'application/vnd.atlas.2025-03-12+json';

export function assessSnapshots(results, { now = new Date(), maxAgeHours = 26 } = {}) {
  const completed = results.filter((s) => s.status === 'COMPLETED' && s.finishTime).sort((a, b) => Date.parse(b.finishTime) - Date.parse(a.finishTime));
  const newest = completed[0] ?? null;
  const failedAfter = results.filter((s) => s.status === 'FAILED' && (!newest || Date.parse(s.scheduledTime ?? s.finishTime ?? 0) > Date.parse(newest.finishTime)));
  const ageHours = newest ? (now.getTime() - Date.parse(newest.finishTime)) / 3_600_000 : null;
  let verdict = 'FRESH';
  if (!newest) verdict = 'NO_SNAPSHOT';
  else if (failedAfter.length) verdict = 'FAILED_SNAPSHOT';
  else if (ageHours > maxAgeHours) verdict = 'STALE';
  return { verdict, newestFinishTime: newest?.finishTime ?? null, ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10, completed: completed.length, failedAfterNewest: failedAfter.length, maxAgeHours };
}

async function token(fetchImpl, id, secret) {
  const res = await fetchImpl(`${API}/api/oauth/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw Object.assign(new Error('token'), { status: res.status });
  return (await res.json()).access_token;
}

export async function checkFreshness({ env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  for (const v of ['ATLAS_CLIENT_ID', 'ATLAS_CLIENT_SECRET', 'ATLAS_GROUP_ID', 'ATLAS_FLEX_CLUSTER']) if (!env[v]) return { refused: `${v} is required` };
  if (!/^[0-9a-f]{24}$/.test(env.ATLAS_GROUP_ID)) return { refused: 'ATLAS_GROUP_ID must be a 24-hex project id' };
  if (!/^[A-Za-z0-9-]{1,64}$/.test(env.ATLAS_FLEX_CLUSTER)) return { refused: 'ATLAS_FLEX_CLUSTER must be a cluster name' };
  const maxAgeHours = env.ATLAS_SNAPSHOT_MAX_AGE_HOURS ? Number(env.ATLAS_SNAPSHOT_MAX_AGE_HOURS) : 26;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 240) return { refused: 'ATLAS_SNAPSHOT_MAX_AGE_HOURS must be 1-240' };
  try {
    const bearer = await token(fetchImpl, env.ATLAS_CLIENT_ID, env.ATLAS_CLIENT_SECRET);
    const res = await fetchImpl(`${API}/api/atlas/v2/groups/${env.ATLAS_GROUP_ID}/flexClusters/${encodeURIComponent(env.ATLAS_FLEX_CLUSTER)}/backup/snapshots?itemsPerPage=100`, { headers: { authorization: `Bearer ${bearer}`, accept: ACCEPT } });
    if (!res.ok) return { verdict: 'UNAVAILABLE', httpStatus: res.status };
    return assessSnapshots((await res.json()).results ?? [], { now, maxAgeHours });
  } catch (error) {
    return { verdict: 'UNAVAILABLE', httpStatus: error?.status ?? null };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await checkFreshness();
  if (result.refused) {
    process.stderr.write(`atlas-snapshot-freshness: ${result.refused}\n`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.verdict === 'FRESH' ? 0 : 1;
}
