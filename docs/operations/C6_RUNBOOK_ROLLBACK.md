# C6 runbook 3 — rollback

| | |
| --- | --- |
| Scope | C6 plan r3 §§4.6.1, 8.1, 8.3; Doc 15 §§209–212. Written at C6-T6 (local) |
| Principle | Roll back **code** by redeploying a previously verified SHA; roll back **configuration** by restoring the previous value. **Never** roll back the database or storage to undo a code release |

## 1. What to roll back, and how

| Problem | Rollback | Effective | Verify |
| --- | --- | --- | --- |
| A bad release (code) | Owner: Manual Deploy → Deploy a specific commit → the **previous verified SHA**, on **both** services of the environment | minutes | R14 on both services = the previous SHA; the checker's listed run; start-up lines |
| Recruitment must close now | `RECRUITMENT_MODE=closed`, restart the API | about a minute | start-up line `closed`; the Jobs list empty for a listed tester |
| Monitoring misbehaves | `SENTRY_DSN` empty, restart | about a minute | start-up line `errorMonitoring: disabled` |
| A wrong allowlist or hop count | the previous value, restart; then G-ACCESS in full | about a minute | G-ACCESS rows 3, 4, 5, 8 |
| A DNS step (P2–P7) | the old record from the exported zone | the record's TTL | lookups from two resolvers |
| The backup copy schedule | disable the `backup-copy` workflow at GitHub | immediate | no new run |

## 2. Rules

- Both services of an environment run the **same** SHA. A rollback of one is a rollback of both.
- Production's SHA is always one that was deployed and verified on Review.
- `main` is never rewritten. A bad commit is corrected by a later commit.
- A rollback is itself recorded: the time, the SHAs from and to, who authorised it, and the three §8.4 readings afterwards.
- One rehearsed rollback (a previous SHA redeployed in Review) is part of the C6 deployment evidence (plan §8.5).

## 3. What is not a rollback

- **Data loss or corruption** is a restore (runbook 2, §5), into new resources, with its own gate — never a rollback over live data.
- **HSTS** is not sent before P9. After P9 a short `max-age` is the rollback window; a long value or preload cannot be undone quickly.
- **A deleted application** is never "rolled back": the deletion log re-applies it on every restore.
