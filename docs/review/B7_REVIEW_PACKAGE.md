# B7 — independent-review package (Doc 17; Doc 18 §§139–143, §356)

| | |
| --- | --- |
| Milestone | Release B — **B7 Backend Security, Failure & QA Gate** |
| Authorised by | OD-2026-11-04-01 (B6 acceptance and B7 handoff, 2026-11-04) |
| Branch | `b7-work` (local; **not pushed**, not merged, not deployed) |
| Base | `2b00a6288ae8c1037dfa972c56c45ec94816e44d` — the published `b6-work` head (reviewed `6173eea…` preserved beneath it) |
| Change set 1 — B7 core | `c047ef2f027aabb01a13ace9ed4ce1893ab6ea9d` (20 files) |
| Change set 2 — suppression (separately reviewable) | `9e86465ab3c69ab998ed5d1c825e52bf58e4ca9b` (7 files) |
| Documentation | this package and the pre-implementation report, in a third, documentation-only commit |
| Status | **NOT READY FOR GPT REVIEW as a completed milestone.** Two items remain (§9): the owner's Windows + MongoDB `verify:b7` run, and the suppression implementation, which awaits design approval. Both change sets are complete and can be code-reviewed now. Claude does not declare B7 approved. |

## 1. Requirements completed

| Requirement | Evidence |
| --- | --- |
| **Body-discard defect** (the OPEN item since B1; Doc 13 §§55–56; Doc 18 §141 request size). Every answer written while the body is unread now carries `Connection: close` and closes in stages: 8 MiB, 2 s idle, 5 s total. Requests with no body, or whose body was read, keep the connection open. | `b7-http-bounds.test.js` (14) and `apply-connection.test.js` (11, rewritten) pass. Mutation check: with the wrapper removed, **10 of 25 fail**; restored, 25 / 25 pass. |
| **Explicit, justified server timeouts**: headers 30 s, request 180 s, keep-alive 5 s. The 180 s request timeout lets the largest legitimate request (about 5.4 MiB) arrive at roughly 250 kbit/s. Values are constants; tuning behind a proxy is C6. | `server.test.js` (startServer applies them); `b7-http-bounds.test.js` (applied; a header timeout above the request timeout is refused) |
| **Orphan reconciliation** `ops:storage:reconcile` (Doc 15 §§199–205; QA-089) | `b7-orphan-reconciliation.test.js` (23) passes. Mutation check: removing the re-check fails the in-flight test. `tests/db/b7-storage-reconcile.test.js` is written but not run (§5). |
| Controls in reconciliation | Dry run by default; deletion needs both `--delete` and `--confirm-delete`; minimum age 72 h by default, never below 24 h; reference re-checked before every deletion; partial writes and unexpected entries never deleted; links never followed; one-way references only in output and logs; exit codes 0 / 1 / 2; refused before connecting when no storage is configured. | Same tests |
| **Security test matrix**: every Doc 13 §270–281, Doc 17 §§116–139 and Doc 18 §141 item mapped to tests | [`docs/qa/b7/B7_SECURITY_TEST_MATRIX.md`](../qa/b7/B7_SECURITY_TEST_MATRIX.md) |
| Coverage gaps closed by new tests | `$where` on every public input (`b7-injection-negative.test.js`, 28); public resume denial after a real Apply (`b7-public-resume-denial.test.js`, 1); log redaction on 201, 422 and 503 (`b7-log-redaction.test.js`, 3) |
| **Coverage diagnostic** (Doc 17 §§53–56; Doc 18 §142) | `npm run test:coverage` gives lines 76.24 %, statements 75.47 %, functions 83.61 %, branches 75.69 %. No threshold. |
| **Release B gate command** `verify:b7` | Runs `verify:b6`, then the B7 files, coverage and audit (§4) |
| **Suppression — the authorised portion** (handoff item 8) | Production start-up now refuses `APPLICATION_ACKNOWLEDGEMENT_ENABLED=true` (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`); outside production nothing changes. `b7-acknowledgement-gate.test.js` (5) passes. Mutation check: removing the rule fails 2 of 5. |
| Suppression precondition 5 (plan B.1) — designed | The key-material integrity design is now written ([`RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md) rev 7, §4.5.1, PROPOSED) and SUP-22a–f are specified. |

## 2. Requirements not implemented, AWAITING INPUT and deferred

| Item | State | Why |
| --- | --- | --- |
| Suppression register, send-path lookup, operator command, key handling (plan B.2; SUP-1…16, 18–22) | **NOT IMPLEMENTED** | Plan B.1 preconditions 3–5 are unmet: the design details are PROPOSED, the owner has not placed a key, and §4.5.1 needs approval (§9). No real or synthetic production key was created or requested. |
| Protected location of the second key copy | **AWAITING INPUT** | Owner decision |
| HTTPS production; production security headers; CORS origins | Deferred to C6 / C7 | Deployment is not authorised |
| XSS rendering (Doc 17 §§133–134); open redirect (§135) | Deferred to Release C (rendering) and Release E (redirecting sign-in) | No display surface or redirect exists in the backend |
| Multi-instance rate-limit store; malware scanner; production storage provider | Deferred to C6 (the scanner and provider are AWAITING INPUT) | Unchanged |
| R3, acknowledgement budget (D2b), message copy, TOOL-DEP0190 | Outside this authorisation; roadmap status unchanged | Handoff item 9 |

## 3. Files, packages, configuration, database and API

**Change set 1 (`c047ef2`).**

- Added:
  - `backend/src/lib/http/serverTimeouts.js`
  - `backend/src/integrations/storage/orphanReconciliation.js`
  - `backend/scripts/storage-reconcile.mjs`
  - `backend/scripts/verify-b7.mjs`
  - tests: `b7-http-bounds`, `b7-orphan-reconciliation`, `b7-public-resume-denial`, `b7-log-redaction`, `b7-injection-negative`, `db/b7-storage-reconcile`
  - `docs/qa/b7/B7_SECURITY_TEST_MATRIX.md`
- Modified:
  - `src/lib/http/stagedClose.js`, `src/server.js`
  - `src/integrations/storage/localPrivateStorage.js` (`listPrivateObjects`: names, sizes and times; no content read)
  - `package.json`, `package-lock.json`, `vitest.config.js`
  - `tests/apply-connection.test.js`, `tests/server.test.js`
  - `backend/README.md`
- Deleted: none.
- The reconciliation module sits in `src/integrations/storage/` because the repository ignores every other directory named `storage/`, so that private files are never committed. That ignore rule was left unchanged.

**Change set 2 (`9e86465`).**

- Modified:
  - `src/config/env.js`, `.env.example`, `scripts/verify-b7.mjs`, `README.md`
  - `docs/architecture/RECIPIENT_SUPPRESSION_DESIGN.md` (rev 7)
  - `docs/review/IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md` (B.1 status)
- Added: `tests/b7-acknowledgement-gate.test.js`.

**Packages.** One new development dependency, `@vitest/coverage-v8` **5.0.3**; its peer is `vitest` 5.0.3, the version already locked. The lockfile adds 12 dev-only packages:

| Package | Version |
| --- | --- |
| `@babel/helper-string-parser` | 7.29.11 |
| `@babel/helper-validator-identifier` | 7.29.7 |
| `@babel/parser` | 7.29.12 |
| `@babel/types` | 7.29.11 |
| `@bcoe/v8-coverage` | 1.0.2 |
| `@vitest/coverage-v8` | 5.0.3 |
| `@vitest/istanbul-lib-coverage` | 1.0.2 |
| `@vitest/istanbul-lib-report` | 1.0.2 |
| `ast-v8-to-istanbul` | 1.0.7 |
| `js-tokens` | 10.0.0 |
| `magicast` | 0.5.5 |
| `tinyrainbow` | 3.2.0 |

There is no new runtime dependency.

**Environment variables.** None added. `APPLICATION_ACKNOWLEDGEMENT_ENABLED` gains a production refusal.

**Database.** No schema, index or data change. Reconciliation reads `applications.resume.storageKey` through the existing unique index (`$in`, batches of 500, `maxTimeMS`).

**API.** No route, status code or envelope changed. The only change is connection handling after an early answer: `Connection: close` and a staged close. This applies to the general 429, which B1 used to answer with the connection kept open.

**Security controls shipped.**

- The bounded discard and the explicit timeouts (DoS limits).
- Fail-closed refusal of production acknowledgements (G-SUP).
- Reconciliation that never deletes by default, never follows links and never logs keys or names.

## 4. Commands executed and results (2026-11-04, Linux sandbox, Node 24.21.0)

| Command (in `backend/`) | Result |
| --- | --- |
| `npx vitest run` (offline suite, HEAD) | 60 files: **2,305 passed, 1 skipped, 0 failed**. The skip is the Windows-only test `storage-link-confinement.test.js:327`. |
| The same suite on change set 1 alone (`git archive c047ef2`) | 59 files: **2,300 passed, 1 skipped, 0 failed** |
| `npm run test:coverage` | Exit 0. Figures as in §1. |
| B7 acceptance files (inside `verify:b7`) | Exit 0, **PASS** |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `node scripts/verify-b7.mjs` | Exit 1, as expected here (see below) |
| Mutation checks | Body discard: 10 / 25 fail, then 25 / 25 restored. Re-check: 1 / 23 fail, then restored. G-SUP rule: 2 / 5 fail, then restored. |
| Privacy scan of the B7 diff | No match for personal paths, consumer mailboxes, owner names, private keys or credential patterns |

`verify:b7` in the sandbox:

- PASS: Node 24, the B7 acceptance gate, the audit.
- DIAGNOSTIC: coverage.
- FAIL: the real-database gate. There is no MongoDB in the sandbox, so `verify:b6` reports its offline suite and the B6, B5 and B4 gates as PASS and its database gate as FAIL.

**This is not Release B evidence.**

**Manual and external verification.** No live email, provider, DNS or deployment action was taken. There are no screenshots: B7 has no UI.

API, storage and log evidence is test-executed against real Express, real sockets and the real local storage adapter (file system). Database evidence is pending (§9).

## 5. Owner Windows + MongoDB run (required for Doc 18 §143)

Use a **separate clone**, so the original workspace and its uncommitted work are not touched. The B7 commits arrive as a Git bundle; the bundle is not a push.

```powershell
git clone https://github.com/SaEeDX4/valida.git valida-b7-review
cd valida-b7-review
git fetch origin b6-work
git bundle verify ..\valida-b7-work.bundle
git fetch ..\valida-b7-work.bundle b7-work:b7-work
git switch b7-work
git log --oneline -4          # top three: the B7 commits; then 2b00a62
cd backend
npm ci
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run verify:b7
echo "exit=$LASTEXITCODE"
```

**Expected result.** Every gate PASS; coverage DIAGNOSTIC; exit 0. Inside it, `verify:b6` returns exit 2 (live gate PENDING by design), which counts as PASS.

**Return.**

- The summary block and the exit code.
- The `Test Files` / `Tests` lines of the offline suite and of the database suite.
- Any FAIL output.

The run is fully synthetic: it sends no email and touches no production data.

## 6. Known defects and issues

- None open from B7.
- The B7 socket tests (staged close and half-close) have not yet run on Windows. Windows behaviour mattered in B6 (r2 resets), so the owner's run is the confirmation.

## 7. Questions for GPT review

1. Are the closing behaviour and its bounds acceptable? The general 429, B1's 404 and B4's non-multipart 415 now close the connection when the body is unread.
2. Is the timeout justification adequate (§1)?
3. Is the reconciliation safety model adequate? In particular the 72 h / 24 h window, and partial writes being reported, never deleted.
4. Is the production acknowledgement refusal acceptable as the minimal G-SUP enforcement?
5. Is suppression design rev 7 §4.5.1 and the SUP-22a–f specification acceptable?
6. Does the matrix cover every item, and are the OUT items correct?

## 8. Not done, by instruction

- No push or merge of `b7-work`.
- No deployment.
- No production configuration change.
- No live email.
- Nothing outside the authorisation (R3, D2b, message copy).
- No change to the B6 commits.

## 9. Consolidated blockers and decisions

| # | Item | Owner | Blocks |
| --- | --- | --- | --- |
| 1 | The Windows + MongoDB `verify:b7` run (§5) | Owner | §143 "database connects / persistence / tests pass"; B7 completion |
| 2 | Suppression design approval, as one decision: (a) storage choice — keyed HMAC, or the plaintext alternative; (b) the fail-closed key lifecycle (rev 5); (c) operator identifiers (§3.4); (d) the §4.5.1 key-check design, its `recipient_suppression_keys` collection, the `key-register` subcommand and SUP-22a–f | Owner, after GPT review | Implementing plan B.2 (synthetic keys only) |
| 3 | The protected key-copy location — **AWAITING INPUT** | Owner | Production key handling; not needed to implement and test with synthetic keys |
| 4 | Placing the production HMAC key in the host secret store (Claude never sees it) | Owner, at C6 | Enabling acknowledgements; G-SUP stays closed until then |
| 5 | GPT review of both change sets (§7) | GPT, then the owner's decision | B7 push / merge |
