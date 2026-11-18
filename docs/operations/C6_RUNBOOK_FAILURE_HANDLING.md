# C6 runbook 2 — failure handling

| | |
| --- | --- |
| Scope | What to do when a C6 check, job or service fails. Written at C6-T6 (local); hosted facts in brackets are still to be confirmed on the host |
| Rule | **Stop, record, then act.** Nothing is "fixed" by weakening a check, deleting a record to make a count zero, or skipping a gate. A fix is a new commit through review |

## 1. CI is red

| Where | Do |
| --- | --- |
| Audit gate `FAIL` | Read the gate's lines and the `audit-*` artifact (the raw report and npm's exit code). `BLOCKING_ADVISORY`: a new finding at high or above — check production exposure, apply the smallest supported fix, record it. `REMEDIATION AVAILABLE`: a patched `picomatch` exists — follow the removal procedure in owner record 2026-11-18-01. `EXPIRED`: the exception ended on 2026-12-18T05:31:00Z — remediate, or obtain a **new** owner decision (never edit the dates). `PATH_EXPANSION`, `UNREVIEWED_VERSION`, `PRODUCTION_EXPOSURE`: the reviewed scope no longer matches — review before anything else. `AUDIT_ERROR`, `MALFORMED_REPORT`, registry unreadable: re-run once; if it persists, it is a CI fault, not a pass. Never `--force`, never a downgrade, never `--omit=dev` or `continue-on-error` |
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

Only with a named authorisation: `npm run ops:backup:delete-application -- --application <id> --authorisation <decision id> --confirm`, with the API's own configuration and the log-writer role.

The order (corrected at C6-T6 after Astra's review): **log entry → object → record**. The Application record is removed only after the store has confirmed the object absent, so the record is the durable to-do until the deletion is finished.

| Result (`status`; exit) | Meaning | Do |
| --- | --- | --- |
| `COMPLETE`; 0 | The object is confirmed absent (`object`: `DELETED` now, or `ABSENT` already) and the record is removed | Nothing |
| `INCOMPLETE`; 1, `object: UNCERTAIN` | The log entry is written; the store gave no definite answer (refused, unreachable, or the answer was lost — the deletion may or may not have happened) | **Run the same command again.** The record is still there, so the retry finds the object; a 404 then counts as done |
| `INCOMPLETE`; 1, `reason: DATABASE_UNAVAILABLE` | The object is removed; the record could not be | Run it again: the store answers 404, then the record is removed |
| `OBJECT_MISMATCH`; 1 | The object under the key is **not** the one the record states (size or SHA-256 differ). Nothing was removed; the record is kept | **Incident.** Never delete it by hand; find out how the key came to hold other bytes |
| `NO_RECORD`; 0 | No such Application: nothing touched, nothing logged | Either an earlier run completed, or the id is wrong — check the id |
| Error before any result; 1 | The log entry could not be written | Nothing was deleted. Restore access to the log bucket; run it again |

Each run that gets past the log appends its own entry; a restore applies every entry and is repeatable, so the duplicates are harmless. The command's output holds the Application id and the one-way object reference, never the storage key.
