# C6 runbook 1 — the first hosted run (CI, Review deployment, verification)

| | |
| --- | --- |
| Scope | C6 plan r3 §§6, 7.1, 8.1–8.5, 4.6.5; written at C6-T6 (local). **Nothing here is authorised by this runbook.** Each numbered act needs the owner's own written authorisation (plan §12) |
| Who | **Owner** executes every act at GitHub, the host and the providers, and types every secret. **Claude** supplies the steps, reads public results, and checks evidence |
| Never | A secret, connection string, tester address or applicant field in a message, a commit or evidence |

## 0. Before anything

- The SHA under review is named in an accepted review package (act A). Write it down as `SHA`.
- Decided: **D-4b** (storage provider; it must offer bucket versioning with HEAD/DELETE by `versionId` — the C6-T4 driver refuses to start without it), D-1 (region), D-10 (repository settings).

## 1. First CI run (the activation of `ci.yml` and `e2e.yml`)

Pushing `c6-work` runs **no** workflow (plan §6). CI first runs when a pull request into `main` is opened, or when `main` moves. **That opening is the activation**, and is authorised as such.

1. Owner (authorised): open the pull request `c6-work` → `main`, or fast-forward `main` (P0).
2. Wait for `ci` and `e2e` on **that exact SHA** (the run page shows the commit).
3. Record, per job: result, run URL, duration. Expected today:

| Job | Expected | Why |
| --- | --- | --- |
| `ci / backend` | **red at `npm audit --audit-level=high`**: the `picomatch` advisory GHSA-fc5q-39xc-vjpf in development tooling, no fix released | `mongoose` resolved (9.11.4); production dependencies audit clean; every other step green |
| `ci / storage-double` | green | moto from `backend/tests/s3/requirements-moto.txt` |
| `ci / frontend` | green | |
| `ci / e2e guards and C5 statistics` | green | |
| `e2e` | green (advisory) | first run on GitHub's runners: if a timing-sensitive case differs from local, record it; do not loosen it |

4. If anything else is red: runbook 2, §1.
5. Not done here: making `ci` a required check (D-10), branch protection, secret scanning — separate authorisations.

## 2. Review deployment (acts C and D, plan §8.2)

1. Owner: deploy `SHA` to the Review API and the Review document server (Manual Deploy → Deploy a specific commit). Auto-deploy stays **Off**.
2. Reading 1: screenshot each service's deploy record (commit, time, result).
3. Start-up lines (host log), both services: `site access` = `private`; `recruitment access` effective mode; `release identity` = `SHA`; `error monitoring` = `enabled` (transport `https`). No allowlist, no DSN in any line.
4. Reading 2 — the checker, from a **listed** machine (Node 24, a fresh folder):

```
cd ops\review-host
npm ci
npx playwright install chromium
node check.mjs --site https://<review site> --api https://<review api> --sha <SHA> --mode review --perspective listed --out listed-1
```

5. The same from an **unlisted** network (a laptop tethered to a phone on mobile data):

```
node check.mjs --site https://<review site> --api https://<review api> --sha <SHA> --mode review --perspective unlisted --listed-sample <a listed address> --out unlisted-1
```

   `--listed-sample` is used only to try spoofing; it is never written to the results.
6. Return both folders (`summary.json`, `mapping.json`, `results/*.json`). Nothing in them is secret.
7. Reading 3 (Claude): the GitHub ref contains `SHA`; the asset names in the served HTML equal a local build of `SHA` with the same build variables.

## 3. Gate G-ACCESS (R0) — before any synthetic Job

`mapping.json` lists every row; the checker covers rows 3, 4, 5 and the half of 8 that each run can see. The operator rows:

| Row | Step |
| --- | --- |
| 1 | The start-up lines (§2.3) |
| 2 | The address probe (H1–H3) on each hostname; then remove the probe key |
| 6 | Redeploy the document server once with a wrong `INTERNAL_SERVICE_KEY`; the listed checker run must then fail R0.5 for documents; restore the key |
| 7 | Screenshot "edge caching: None" on all four services |
| 8 | Listed run then, at once, unlisted run (and the reverse); both pass R0.8 and R7; the unlisted run passes R0.3 |
| 9 | From the unlisted network: `curl.exe -sS -o NUL -w "%{http_code}\n" -X POST -H "Content-Type: multipart/form-data; boundary=x" --data-binary "@<a 6 MB synthetic file>" https://<review api>/api/v1/jobs/qa-any/applications` → `403`, promptly |
| 10 | Rows 3 and 5 from an IPv6 network, or record "untested" and list no IPv6 range |

**Stop if any row fails.** No synthetic Job is provisioned until every row has passed on every hostname.

## 4. After the synthetic Jobs: R1–R14

Re-run the checker listed with `--job <open synthetic slug> --closed-job <closed synthetic slug>`, and unlisted with `--job <open slug>`. Operator rows: R1 (API stopped → 503 once), R10, R11 (unauthenticated object read at the provider), R12 (Lighthouse), R13 (marker application; search the host logs **and** the error monitor).

**Expected local differences that are host facts, not defects:** R6 (compression) is provided by the host edge or is absent; if absent, plan §13 applies (a document-server change).

## 5. Monitoring (D-4a)

1. Owner: create the Sentry project (data region as decided), copy the DSN into each service's secret `SENTRY_DSN`. Restart.
2. From each service's shell (or a one-off job with the same environment): `npm run ops:monitoring:test-event` (backend) and `npm run monitoring:test-event` (frontend). Expected: one JSON line, `"delivered":true`, the release `SHA`, exit 0.
3. In Sentry: two events (`valida-api`, `valida-documents`), release `SHA`, environment `review`, level `info`, message "Operator test event (contains no application data)". Screenshot.
4. R13: the marker application; confirm no marker in Sentry either.
5. One alert rule (new issue → email to the owner); prove it once with a test event.

## 6. Backups (D-9)

1. Owner: the copy bucket and the log bucket, each with a **retention lock** at least the snapshot retention; the four role tokens (`copier`, `manifest`, `log-writer`, `restorer`) scoped as in `backend/src/ops/backup/backupConfig.js`; a read-only database user for the manifest.
2. GitHub: the protected environment `backup` (deployment branches: `main` only), its variables (`BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_PRIMARY_BUCKET`, `BACKUP_COPY_BUCKET`, `BACKUP_LOG_BUCKET`) and secrets (`BACKUP_COPIER_*`, `BACKUP_MANIFEST_*`, `BACKUP_MANIFEST_MONGODB_URI`).
3. First copy: run `backup-copy` manually; expect `complete: true`.
4. After the first provider snapshot: run `backup-manifest` with its id and time; expect `PRELIMINARY: NO DEFECT FOUND`.
5. The rehearsal (plan §5.6 with r3 correction 1): runbook 2, §5. Until it passes, no snapshot is described as verified.

## 7. Record

One review package: the SHA, the three readings for each service, both checker folders, the G-ACCESS rows, the CI run URLs, the Sentry screenshots, the backup outputs. Redacted of addresses and secrets.
