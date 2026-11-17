# C6 runbook 2 — failure handling

| | |
| --- | --- |
| Scope | What to do when a C6 check, job or service fails. Written at C6-T6 (local); hosted facts in brackets are still to be confirmed on the host |
| Rule | **Stop, record, then act.** Nothing is "fixed" by weakening a check, deleting a record to make a count zero, or skipping a gate. A fix is a new commit through review |

## 1. CI is red

| Where | Do |
| --- | --- |
| `npm audit` | Known: the `mongoose` advisory. Record; the owner decides upgrade or a dated risk acceptance. Never `--force` |
| Any test | Re-run **once** to rule out a runner fault; if it fails again it is a defect: reproduce locally on the same SHA, fix by a new commit. A test is never loosened to pass |
| `storage-double` | Usually the moto install: compare the versions with `backend/tests/s3/requirements-moto.txt` |
| A workflow file | `actionlint` and `zizmor` locally (both were clean at C6-T6) |

## 2. A deployment fails or misbehaves

| Symptom | Do |
| --- | --- |
| The service refuses to start | The host keeps the previous version. Read the start-up failure line: it names the variable (never its value). Correct the configuration at the host, redeploy the same SHA |
| R14: wrong or missing `X-Valida-Release` | Do not continue. Compare with the deploy record; redeploy the approved SHA to **both** services |
| R0 / G-ACCESS row fails | **Stop** (plan §4.6.5). `RECRUITMENT_MODE=closed`; no Job is provisioned; investigate H1–H8 |
| R7 / R0.8: a cached or shared response | Edge caching to "None" (row 7) first; then re-run listed + unlisted |
| R8: a CSP violation | Record route and browser; a fix is a code change — the policy is not widened at the host |

## 3. Error monitoring

| Symptom | Meaning | Do |
| --- | --- | --- |
| Log: `error monitor delivery failing` (`reason`: `unreachable`, `timeout`, `status`) | Events are not reaching Sentry. Application outcomes are unaffected (by design) | Check the DSN secret and the Sentry status; `ops:monitoring:test-event` after the fix; the log says `restored` |
| A marker found in Sentry (R13) | A redaction defect | **Incident.** Delete the event in Sentry; disable monitoring (`SENTRY_DSN` empty, restart) until a fixed SHA is deployed |

## 4. Backup jobs

| Job result | Meaning | Do, the same day |
| --- | --- | --- |
| `backup-copy` fails or `complete: false` | Some objects were not confirmed in the copy | Read `failed[]` (one-way references and fixed reasons). Re-run manually: a repeated run is safe (nothing is overwritten or written twice). `SOURCE_CHECKSUM_MISMATCH` or `COPY_CONFLICT` is an **incident**: never overwrite or delete to "fix" it |
| `backup-manifest`: `UNASSESSED` | No complete copy run started after the snapshot, or the log could not be read | Run `backup-copy`, then the manifest again. Not a backup of candidate data until it is NO DEFECT FOUND |
| `backup-manifest`: `PRELIMINARY: DEFECT FOUND (n)` | n Applications whose copy is absent or wrong | For each: if `primaryHoldsGoodObject: YES`, run `backup-copy` now and re-run the manifest. If `NO`, the file is lost: incident (Doc 13), cause recorded; what to tell the candidate is the owner's decision. Never delete the record |

## 5. Restore (plan §5.4; the r3 correction 1)

The restored system starts and stays **`RECRUITMENT_MODE=closed`**.

1. Owner: restore the snapshot into a **new** cluster; create a **new**, empty, versioned bucket.
2. `npm run ops:backup:restore -- --snapshot-id <id> --snapshot-time <ISO> --report restore.json` with the restorer's role variables, `BACKUP_RESTORE_BUCKET` and `BACKUP_RESTORE_MONGODB_URI` (never the live ones; the command refuses them).
3. Read the verdict:

| Verdict | Do |
| --- | --- |
| **RECOVERY VERIFIED** | Indexes (`npm run db:indexes:check` on the restored database), an unauthenticated object read refused, readiness 200 on a throwaway API **in closed mode**. Only then may the owner authorise reopening |
| **RECOVERY FAILED**: `MISSING_UNEXPLAINED_n` / `MISMATCH_n` | Stay closed. Restore a different snapshot, or serve with those applications in an incident record — the owner's decision; it never turns the verdict into VERIFIED |
| **RECOVERY FAILED**: `DELETION_LOG_UNAVAILABLE_*` | Stay closed: restored data may include applications a person asked to have deleted. Restore access to the log bucket; run again |

4. Record: the snapshot used, its age at the loss (measured RPO), the time to readiness and to the first application after reopening (measured RTO) — measured figures, never targets.

## 6. A deletion that someone asked for

Only with a named authorisation: `npm run ops:backup:delete-application -- --application <id> --authorisation <decision id> --confirm`, with the API's own configuration and the log-writer role. The log entry is written **first**; if it cannot be, nothing is deleted. A repeated run is safe.
