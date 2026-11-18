# C6-T6 — error monitoring, CI, the review-host checker, runbooks, and the hourly backup with its restore gate

| | |
| --- | --- |
| Milestone | Release C, C6; plan revision 3, steps **2e** and **2f**, with the r3 correction 1 (restore rehearsal) |
| Authorisation | [Owner record 2026-11-17 (second)](OWNER_RECORD_2026-11-17-02_C6_T5_ACCEPTANCE_D4A_D9_AND_C6_T6_AUTHORISATION.md): T5 accepted; D-4a and D-9 approved; local only |
| Governing | Doc 13 §§112–118, 213, SEC-059–SEC-063; Doc 15 §§176–198, 209–212; Doc 17 QA-085–QA-088, §407; Doc 18 §§176–180; plan r3 §§4.5, 5, 6, 7.1, 8.4, 8.5 |
| Status | Implemented and tested locally on `c6-work`. **Not accepted.** Nothing is pushed; no workflow has run on GitHub |

## 1. Error monitoring (D-4a: Sentry)

**Where:** the API's central error handler (each unexpected 500) and uncaught exceptions; the document server's 500 path and uncaught exceptions (plan §4.5). Handled outcomes (4xx, 503) are not sent. **No browser capture.**

**SDK:** `@sentry/core` **11.10.0**, exact, in both services (MIT; one dependency, `@sentry/conventions` 0.29.0). Only its server-runtime client, transport factory, Node stack parser and `Scope`. `@sentry/node` and its automatic instrumentation are not installed: nothing hooks HTTP, the console or local variables. The frontend imports it from `server/` only; the browser bundle does not contain it (checked: no `sentry` in `dist/`).

**What an event can contain — rebuilt from an allowlist, never scrubbed** (`backend/src/lib/monitoring/errorMonitor.js`):

| Field | Content |
| --- | --- |
| exception type | the built-in class (`instanceof`), or `Error`; `non-error:<typeof>` |
| exception value | fixed text `Unexpected <type>` (plus a code from the B1 allowlist) |
| frames | repository-relative file (`app:///backend/src/…`), **only a file that exists in the repository**, line, column, in_app. **No function name, no source line, no variable** |
| tags | `service`, `kind` (`request`, `uncaught`, `operator_test`), `status`, `request_id` **only when it is a UUID** |
| release, environment | `RENDER_GIT_COMMIT`, `APP_ENV` |
| server_name | `valida-api` / `valida-documents` — never the host name |

Frames are parsed only after the error's own first line, and only when that line is exactly `name: message`, so a message cannot forge a frame. A hand-replaced stack still carries no text: no function name, and a non-existent file becomes `<unknown>`.

**Stricter than the log, deliberately:** the accepted B1 middleware echoes a client's `X-Request-ID` of the allowed form as `reqId` in the log. The monitor sends a request id only in the API's own UUID form.

**Configuration:** `SENTRY_DSN` (a secret). Absent or empty → disabled, nothing sent. Malformed → refused before listening, naming the variable only. `https://<32-hex key>@<host>/<project>`, no password, query or fragment; `http://` only for a loopback receiver with `APP_ENV=local`. The start-up line states `errorMonitoring` and the transport kind, never the DSN.

**Delivery** never changes an outcome: capture returns at once; one bounded attempt (5 s) per envelope; at most 64 queued; a failure is logged **once** when delivery starts failing and once when it recovers, by a fixed reason (`unreachable`, `timeout`, `status`).

**Operator test event** (plan §8.5): `npm run ops:monitoring:test-event` (backend), `npm run monitoring:test-event` (frontend).

## 2. CI (plan §6)

| File | Trigger | Content |
| --- | --- | --- |
| `.github/workflows/ci.yml` | `pull_request` → `main`; `push` to `main` | backend: `npm ci`, `npm test`, `npm run test:db` (MongoDB service), `npm audit --audit-level=high`. storage-double: `test:s3`, `test:backup` on moto (exact versions, `backend/tests/s3/requirements-moto.txt`). frontend: `npm run verify:quality`. e2e: `test:guards`, `test:c5:stats`, `test:c5:motion` |
| `.github/workflows/e2e.yml` | `pull_request` → `main` (path-filtered); manual | `test:e2e`, `test:e2e:seo`, `test:e2e:c5` without c5-03, c5-04 (lab performance) and c5-99 (hold); uploads the JSON reports only |
| `.github/workflows/backup-copy.yml` | hourly (`17 * * * *`); manual | the copy (§4), environment `backup`, the copier's token |
| `.github/workflows/backup-manifest.yml` | manual (snapshot id and time as inputs) | the manifest, environment `backup`, the manifest role and its read-only database user |

Everywhere: `permissions: contents: read`; no `pull_request_target`; actions pinned to commit SHAs; `persist-credentials: false`; Node from `.nvmrc`; the package-manager cache off. **No workflow deploys.** `ci` and `e2e` hold no secret.

**Validated:** actionlint 1.7.12 — clean; zizmor 1.32.0 (auditor persona) — exit 14, two high `unpinned-images` findings, `mongo:8.0` in `ci.yml` and `e2e.yml`. Every command the workflows run was run locally (handoff §3).

**The image digest — not pinned, and why.** Read-only registry access has been refused every time it was tried, on 2026-11-17 (correction 1) and again on 2026-11-18 05:16 UTC (the CI remediation). The egress gateway answers **HTTP 403 to CONNECT** for `auth.docker.io`, `registry-1.docker.io` and `index.docker.io` (curl exit 56, "CONNECT tunnel failed, response 403"; the gateway lists each as `connect_rejected`). Earlier, the same was seen for `hub.docker.com`, `mirror.gcr.io` and `public.ecr.aws`, and the web-fetch tool refused `hub.docker.com`. A secondary source, GitHub's `docker-library/repo-info` (`repos/mongo/remote/8.0.md`, commit `6472840a`), lists `mongo:8.0` as `sha256:bdc216e9d5a6ec2cfdac789b5832fdab64cd32055f59885cae918a92de63c361`. That is **not registry-verified**, and the workflows are not pinned to it.

The owner-side check (Windows PowerShell, no Docker needed) prints the registry's own digest for the tag:

```powershell
$t=(Invoke-RestMethod "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/mongo:pull").token; (Invoke-WebRequest -Method Head "https://registry-1.docker.io/v2/library/mongo/manifests/8.0" -Headers @{Authorization="Bearer $t"; Accept="application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json"}).Headers["Docker-Content-Digest"]
```

Then pin both references as `mongo:8.0@<that digest>` (`ci.yml`, `e2e.yml`) and re-run zizmor. The tag moves, so the digest is the one the owner reads, whether or not it equals the secondary value.

**Dependency remediation (authorised 2026-11-17, third record).**

| Package | Before | After | Why | Scope |
| --- | --- | --- | --- | --- |
| `mongoose` (backend, direct) | 9.10.2 (`^9.10.2`) | **9.11.4** (`^9.11.4`) | first release outside GHSA-gg4r-jv3p-qx3c, GHSA-8332-j7wj-wjw4 (high), GHSA-wr5m-5jph-8m96, GHSA-6972-9mcm-vhwj (moderate), all `>=9.0.0 <9.11.4` (re-verified against npm's advisory service) | production |
| `mongodb`, `bson`, `kareem`, `mquery` | 7.6.0, 7.3.3, 3.4.0, 6.0.0 | 7.7.0, 7.3.4, 3.4.1, 6.0.1 | required by `mongoose` 9.11.4 | production |
| `mongodb-connection-string-url`, `whatwg-url`, `tr46`, `webidl-conversions`, `@mongodb-js/saslprep` | 7.0.2, 14.2.0, 5.1.1, 7.0.0, 1.5.4 | 7.0.3, 15.1.0, 6.0.0, 8.0.1, 1.6.3 | required by `mongodb` 7.7.0 | production |
| `vite` (frontend, direct) | 8.2.2 (`^8.2.2`) | **8.2.4** (`^8.2.4`) | the smallest release outside GHSA-587h-7wmj-h5pm and five lower-severity advisories (`>=8.2.0 <=8.2.3`) | development (build) |
| `vitest`, `@vitest/mocker`, `@vitest/spy` (frontend) | 5.0.0 | **5.0.3** | GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp (`<5.0.3`) | development |
| `undici` (frontend, via `jsdom`) | 8.10.2 | 8.12.4 | GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm (high) and four moderate (`<8.12.2`); npm's in-range update | development |
| `source-map-js` (frontend) | 1.2.1 | 1.2.2 | GHSA-68fv-2mgg-jv7q (`<1.2.2`); in-range update | development |
| `picomatch` (both, via `vite`, `vitest`, `tinyglobby`, `fdir`) | 4.0.7 | **4.0.7 — no fix exists** | GHSA-fc5q-39xc-vjpf (high, `<=4.0.7`, ReDoS via repeated single-branch extglobs) | development |

There was no `audit fix --force`, no downgrade and no exception. The resolution was done with npm 11.21.1, the npm Node 24 ships (the container's npm 10.9.9 crashes in its peer-set resolution on the frontend tree); the lock files stay version 3. **The production build of the frontend is byte-identical before and after** (39 files, SHA-256 compared).

**After:** `npm audit --omit=dev` finds **0** in all four packages. The full `npm audit --audit-level=high` still exits **1** in `backend` and `frontend`, with 6 high findings each. All six are the one `picomatch` advisory and the tooling packages that depend on it, and npm's only offered "fix" is a semver-major *downgrade* (vite 6.2.7 / vitest 3.1.4). **`ci / backend` therefore stays red at its audit step.**

**`picomatch` — no supported fix; the decision needed.**

- **Upstream status:**
  - npm's latest release is 4.0.7 (2026-08-24).
  - The advisory came out on 2026-10-19 (CVE-2026-112366, Red Hat: Important, 7.5).
  - The upstream `master` has 19 commits since 4.0.7, the last on 2026-08-27, and none touches the affected code.
  - The referenced pull request (micromatch/picomatch#194) is not in any branch.
- **Exposure:** development and build tooling only. `vite` and `vitest` match globs that come from this repository's own configuration, never from a request. Nothing from `picomatch` is in the API's runtime or the browser bundle. The document server's host runs `vite build` once, on the repository's own configuration.
- **Smallest decision:** a **dated, scoped risk acceptance** for GHSA-fc5q-39xc-vjpf in development tooling, until upstream publishes a fix. It needs a way to express it that keeps the gate whole for everything else. The workflow cannot simply audit with `--omit=dev`: that would hide every future development-only advisory. The alternative is to accept `ci / backend` (and, if one is added, a frontend audit) red until `picomatch` is released. Either is the owner's call; neither is applied here.

**Needs a real Actions run:** the runner environment (Ubuntu 24.04 image, the service container, the Python on the runner), the `upload-artifact` behaviour, the schedule, the protected environment, fork behaviour. **Expected at the first run:** `ci / backend` red at `npm audit` because of the `picomatch` development-tooling advisory (no fix released). The `mongoose` advisories are resolved (9.11.4).

## 3. The review-host checker (plan §7.1)

`ops/review-host/check.mjs` (its own `package.json`: `playwright` 1.63.0). GET and HEAD only; Chromium launched directly; refuses a non-HTTPS URL (loopback `http` only with `--allow-loopback-http`, stated in every result); **refuses to run without the expected SHA**. One JSON file per check, a summary and `mapping.json`.

**Mapping:** every G-ACCESS row (R0.1–R0.10) and R1–R14 has automated checks or a named operator step, and where it must run: a listed machine, an unlisted network, the host dashboard or log, the provider edge or console, a real device. Automated: R0.3, R0.4, R0.5, R0.8 (each perspective's half), R1–R9, R11 (the response half), R14. Operator: R0.1, R0.2, R0.6, R0.7, R0.9 (a POST: the checker sends none), R0.10, R10, R12, R13, and the by-hand halves.

**Expectations are the accepted contracts**, which govern where older plan text differs:
- R3: robots.txt as accepted at C4 — `Allow: /`, **no** blanket `Disallow: /`, no Sitemap line, itself `noindex` (the plan's "disallows all" predates C4's decision that a noindex must be crawlable to be seen);
- R7: T3 (Review: every response `private, no-store`, no validators) and T2 (Production in `closed`/`testers`: Jobs API `no-store` without validators; Careers, Job and Apply `private, no-store`; assets one year immutable);
- R8: the T5 policy and headers; HSTS reported, expected absent until P9.

## 4. Backup and restore (D-9; plan §5 with r3 correction 1)

`backend/src/ops/backup/`, `scripts/backup.mjs` (`npm run ops:backup:copy | manifest | delete-application | restore`).

**Its own access boundary.** One credential per role; none is the API's token (refused if equal):

| Role | May |
| --- | --- |
| copier | read the primary; write **new** objects in the locked copy bucket; write copy-run records. Delete nothing |
| manifest | read copy and log, HEAD the primary, write manifests; a **read-only** database user |
| log-writer | append deletion-log entries — new objects only, in a locked bucket |
| restorer | read copy and log; write a **new** restore-target bucket and database (the live ones are refused) |

The API's own storage permissions are unchanged. The authorised deletion uses the API's version-bound delete (T4 correction 2), **after** its log entry.

**Correction after Astra's review (authorised deletion).** As first delivered, the command removed the record before the object; a storage failure then left an object that no retry could reach (a retry found no record, logged an entry without an object reference and touched nothing). The order is now **log entry → object → record**: the record is removed only once the store has confirmed the object absent, so a retry always finishes. The object deletion is also bound to the record's size and SHA-256 (`deletePrivateObject(key, { expect })`, checked on the same HEAD whose version the DELETE names), so an unrelated object under the key is never removed. Outcomes: `COMPLETE`, `INCOMPLETE` (run again), `OBJECT_MISMATCH` (an incident), `NO_RECORD`. Without `expect`, the driver behaves exactly as accepted at C6-T4.

**What `expect` establishes, and what it does not.** Matching size and SHA-256 proves **content equality**: the object under the key has the bytes the record describes. It does not prove **independent ownership identity**. An object with identical bytes written separately under the same key, for example a re-submission of the same file under a reused key, would match and could be removed. With a fresh random key per submission and `If-None-Match` on every write, that needs a key collision or a writer outside the API. A per-object identity marker checked at deletion would be the stronger binding; it is **not** part of this task.

**The copy** reads each primary object, computes SHA-256 from the bytes, checks it against the primary's checksum, writes a new object (If-None-Match) with that checksum and the source version, reads the metadata back, and only at the end writes one copy-run record (`complete: true` only when every object was confirmed). Never overwrites or deletes. **An interrupted or failed run cannot make a snapshot assessable**: the manifest requires a complete run that started after the snapshot.

**States:** UNASSESSED; PRELIMINARY: NO DEFECT FOUND; PRELIMINARY: DEFECT FOUND (n) — from the **live** database, preliminary by construction; RECOVERY VERIFIED and RECOVERY FAILED — only from a restore. "Recoverable" is not used.

**The restore** copies the copy into a new bucket, reconciles (OK / MISSING-EXPLAINED / MISSING-UNEXPLAINED / MISMATCH; objects without a record), reads the **whole** deletion log (unavailable → FAILED, stop), applies every entry, reconciles again, verifies every remaining résumé by length and SHA-256 (against the record and, when given, the checksums taken at submission), and checks that deleted data stays deleted. VERIFIED only with no failure anywhere; an owner disposition never makes a failed restore VERIFIED. The restored system stays `closed`; the tool cannot open it.

## 5. Tests and evidence

| Suite | What |
| --- | --- |
| `backend/tests/c6-t6-error-monitoring.test.js` | configuration; the allowlist; a poisoned Apply submission through the real handler, SDK and transport, asserted on the received bytes; handled outcomes not sent; disabled; unreachable, hanging and refusing receivers; start-up; crash capture; the operator command |
| `frontend/server/errorMonitoring.test.js` | the same for the document server, including the enforced CSP on the 500; `serve.mjs` start-up |
| `backend/tests/c6-t6-backup-config.test.js` | the role boundary from configuration |
| `backend/tests/backup/` (`npm run test:backup`, moto) | each role's permissions at the store, the retention lock, the copy (complete, repeated, interrupted by SIGKILL, failed), the deletion log, the manifest |
| `e2e/c6/c6-t6-backup-rehearsal.mjs` | rehearsals D and H on the full stack; MongoDB with access control |
| `e2e/c6/c6-t6-review-checker.mjs` | the checker against the local stack, nine scenarios |
| `backend/tests/c6-t6-authorised-deletion.test.js`, `backend/tests/backup/authorised-deletion.test.js` | the correction: storage failure, lost answer, database failure — each finished by a retry; repeated completion; an unrelated object never removed (failing before the correction, passing after) |
| `e2e/c6/c6-t6-deletion-retry.mjs` | the deletion command itself, interrupted and retried, on the moto double and a MongoDB with access control |
| `ops/review-host/check.test.mjs` | the refusals and the mapping |

Results, commits and environments: the C6-T6 handoff (outside the repository).

## 6. Proposed canonical entries (Doc 00 §5) — **not adopted**

| Document | Proposed entry |
| --- | --- |
| Doc 15 | `SENTRY_DSN` (both services; secret; malformed refuses start-up). The `BACKUP_*` variables of §4, the protected `backup` environment, the four role tokens and the read-only manifest database user |
| Doc 13 §213 | The event allowlist of §1 as the monitoring rule; the backup role boundary of §4 |
| Doc 17 | QA-085–088 evidence: the copy, the manifest, the two rehearsals, as in §5 |

## 7. Open after this task (hosted)

Sentry account, project, data region, DSN, remote delivery and alert; the first Actions run, required checks (D-10) and the `mongo` image digest; the checker on the review host from listed and unlisted networks; provider versioning, version-specific permissions and deletion, retention-lock enforcement, real scheduling and the snapshot-time lookup; the hosted rehearsal and its measured RPO/RTO; **D-4b** (the storage provider must offer versioning — the dependency note after T5, §2).
