# B7 — pre-implementation report (Doc 18 §§139–143)

| | |
| --- | --- |
| Active release | **Release B** — Phase 1 backend |
| Active milestone | **B7 — Backend Security, Failure & QA Gate**. Status: **NOT STARTED, NOT AUTHORISED** |
| Prepared | 2026-11-03, with the B6 r12 package. This report is **not** part of the B6 commit; it goes on the B7 branch when B7 starts |
| Starts only after | (1) GPT's final recommendation on B6 and the owner's explicit B6 acceptance; (2) `b6-work` pushed under the owner's authorisation; (3) a separate, explicit B7 authorisation |
| Branch | `b7-work`, created from the accepted `b6-work`, so the B6 and B7 diffs stay separately reviewable |

## 1. Objective (§139)

"Prove the Phase 1 backend rather than simply finishing code." B7 is a verification milestone: it maps every Phase 1 backend security and failure requirement to an executed test, closes the one known open defect (the body-discard issue), adds the coverage diagnostic, and produces the Release B completion evidence (§143). Product behaviour changes only where a test shows a defect, and each such change is a recorded defect with its fix and rerun (Doc 17 §§348–351).

## 2. Applicable requirements (§140: BE, DATA, CAREER, APP, SEC, OPS, QA)

| Area | Governing text |
| --- | --- |
| §141 security tests | Doc 13 §44–47 (NoSQL injection, prohibited query patterns, operator control, mass assignment); §52–56 (excessive requests, rate limits, request-body DoS, slow requests); §57–68 (file-upload defence in depth, PDF / DOCX allowlist, signature and structure, filename, generated storage name, 5 MiB, private location); §237–240 (error disclosure, request id, health output); §244–247, §254 (method confusion, parameter and prototype pollution, regex DoS, path injection); **§270–281 (Phase 1 security tests)**; §289–291 (threats T01–T03). Doc 17 §116–127 (file tests), **§131–139 (security negative testing)**. Doc 09 §20–29 (error envelope, disclosure, codes, status policy, 100 KB JSON, unknown fields, no mass assignment, query safety), §141–150 (Apply validation, unknown multipart fields, sensitive-response and logging rules). Doc 07 §117–118 (rate limits; no unlimited body) |
| §142 test output | Doc 17 §53–57 (coverage is diagnostic, reported where supported, high confidence for eligibility, validation, lifecycle, idempotency and private files, no coverage gaming, a positive and a negative case for every critical rule) |
| §143 Release B gate | starts; database connects; Jobs API; Apply API; validation; negative paths; persistence; private storage; idempotency; partial failure; tests pass |
| Sequenced into B7 by approved records | The **body-discard issue** (OPEN; blocks public deployment — `backend/README.md`, "Scope and limitations"); **minimal suppression** for Doc 14 §120 (gate G-SUP; preconditions in `docs/review/IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md` Part B.1); R3 operator recovery (PROPOSED); the acknowledgement budget D2b (only if adopted); the automated-message copy (candidate; G-COPY PROPOSED); TOOL-DEP0190 (separately authorised); orphan reconciliation `ops:storage:reconcile` (Doc 15 §§199–205, OPS-065…067; the README says "deferred to B7/C6") |

## 3. Existing repository state that B7 builds on

Baseline: GitHub `main` `ec15048` (B5); B6 on `b6-work` (local commits `6da01e8`, r11, and the r12 documentation commit; not pushed). The lists below come from the code and test files; B7's first step re-executes them and maps each to its requirement. Their presence is not counted as verification.

| Control | Where it lives | Existing tests (by file) |
| --- | --- | --- |
| Security headers | `src/app.js` (helmet) | `security.test.js` |
| JSON body limit 100 KB | `src/app.js`, `src/config/env.js` | `errors.test.js`, `apply-validation-http.test.js` |
| General and Apply rate limits | `src/middleware/rateLimit.js`, `src/app.js` | `security.test.js`, `apply-failures.test.js`, `apply-connection.test.js`, `jobs-http.test.js` |
| Staged close for early Apply answers (8 MiB, 5 s) | `src/lib/http/stagedClose.js` | `staged-close.test.js`, `apply-connection.test.js` |
| Multipart and upload bounds | `src/lib/multipart/` | `upload-abort-limits.test.js`, `upload-temp-failure.test.js`, `temp-upload-area.test.js` |
| Resume allowlist, signature and structure | `src/modules/applications/resume/` | `resume-inspection.test.js`, `docx-xml-structure.test.js`, `pdf-xref-structure.test.js`, `resume-intake-http.test.js` |
| Filename normalisation; storage-key confinement | `resume/filename.js`; `src/integrations/storage/` | `resume-filename.test.js`, `private-storage.test.js`, `storage-link-confinement.test.js` |
| Safe errors | `src/lib/safeError.js`, `src/middleware/errorHandler.js` | `errors.test.js`, `safeError.test.js` |
| Mass-assignment guards; strict schemas | `src/models/writeGuards.js`, `src/models/Job.js` | `services.test.js`, `jobs-provisioning.test.js`, `models.test.js` |
| Operator-shaped input (`$ne`, `$gt`, `$where`) | Apply and Jobs validation | `apply-validation-http.test.js`, `jobs-validation.test.js`, `jobs-dto.test.js`, `db/jobs-api.test.js` |

**Known open items:** the body-discard issue (an early general `429`, B1's `404` or B4's non-multipart `415` lets Node read and discard the rest of the body, bounded only by Node's default `requestTimeout` of 300 s, which `server.js` does not set; measured in `apply-connection.test.js`); no coverage tooling; no orphan reconciliation command; the Apply rate limit counts in process memory (multi-instance store is C6, Doc 13 §54); the never-executed Windows test `storage-link-confinement.test.js:326` (needs Developer Mode or elevation) and the five Windows skips of EV-B6-3-W1.

## 4. Planned work

| # | Work | Requirement | Product change? |
| --- | --- | --- | --- |
| WP1 | **Security test matrix:** every item of Doc 13 §270–281 and Doc 17 §131–139 mapped to an executed test. Existing tests are mapped, not rewritten — for example `apply-validation-http.test.js` already sends `status: SELECTED`, `scanStatus: CLEAN`, `storageKey`, `notifications` and `__proto__` in Apply input. Tests are added only where an item has none | §141; Doc 13 §270–281 | Only on a failing test |
| WP2 | **Body-discard fix:** bound the discard after any early answer server-wide (the staged-close limits, or an equivalent bound), set explicit server timeouts, and measure the bound in a test | §141 "request size"; Doc 13 §55–56; README open item | **Yes** — connection handling only; status codes and envelopes unchanged |
| WP3 | **Safe errors and log redaction** verified on every error path | Doc 13 §237–240, §281; Doc 09 §22, §25, §149–153 | Only on a failing test |
| WP4 | **Private storage**: no public URL or static path; no storage key in any response; confinement on Windows and Linux | Doc 13 §278–279; Doc 17 §125–126 | Only on a failing test |
| WP5 | **Coverage diagnostic**: `npm run test:coverage`, reported, no invented threshold; the Doc 17 §55 high-confidence areas reviewed by line | §142; Doc 17 §53–56 | No (tooling) |
| WP6 | **Release B completion gate**: `verify:b7` runs the B3–B6 gates and the B7 suites; the owner's Windows + MongoDB run; the API evidence chain request → response → database → storage | §143; Doc 18 §§339–355 | No |
| WP7 | **Orphan reconciliation** `ops:storage:reconcile` — dry run by default, explicit delete flag, minimum-age window, no candidate filenames — against the existing storage interface | Doc 15 §§199–205; OPS-065…067; Doc 17 §§320–322 | Yes, a new operator script — **scope decision: B7 or C6** |

**Not bundled into B7's core change** (each is a separately reviewed change, after its own preconditions): minimal suppression (G-SUP), R3, D2b, the automated-message copy, TOOL-DEP0190.

## 5. Expected files (final names in the B7 plan)

- `backend/src/lib/http/` (bounded early-answer discard), `backend/src/app.js`, `backend/src/server.js` (explicit timeouts) — WP2.
- `backend/tests/b7-*.test.js` — WP1–WP4, one file per §141 item.
- `backend/scripts/verify-b7.mjs`; `backend/package.json` (scripts `verify:b7`, `test:coverage`; one dev dependency); a coverage section in the Vitest configuration — WP5, WP6.
- `docs/qa/b7/B7_SECURITY_TEST_MATRIX.md`, the B7 evidence logs and the B7 review package.
- If WP7 is in B7: `backend/scripts/storage-reconcile.mjs` and its tests.

## 6. Packages

| Package | Version | Why | Where |
| --- | --- | --- | --- |
| `@vitest/coverage-v8` | **5.0.3** (dev) | Coverage diagnostic (Doc 17 §54); its peer dependency is exactly `vitest` 5.0.3, the locked version (checked on the npm registry on 2026-11-03) | `backend/` dev tooling only |

No new runtime dependency is planned.

## 7. Environment, database, API

- **Environment variables:** none planned. If the request and header timeouts are made configurable, their names are proposed in the B7 plan for approval.
- **Database:** no change for the B7 core. Suppression, if authorised, has its own collection design (separate change).
- **API:** no new route and no change to documented status codes or envelopes; WP2 changes only how the connection is closed after an early answer.

## 8. Planned commands

| Directory | Command | Purpose |
| --- | --- | --- |
| repository | `git switch -c b7-work b6-work` (after `b6-work` is accepted and pushed) | Separate branch |
| `backend` | `npm ci` | Locked install |
| `backend` | `npm test`; `npm run test:coverage` | Offline suites; coverage diagnostic |
| `backend` | `npm run verify:b6`; `npm run verify:b7` | Earlier gates still pass; the B7 gate |
| `backend` (owner, Windows + MongoDB) | `npm run test:db`; `npm run verify:b7` | Database suites and the §143 evidence |
| `backend` | `npm audit --omit=dev` | Dependency check (Doc 17 §58) |

No live email, no deployment, no DNS or provider change.

## 9. Planned tests (§141–§142)

| §141 item | Tests | Layer |
| --- | --- | --- |
| NoSQL injection | `$ne`, `$gt`, `$where`, nested operator objects and dotted keys in every Jobs and Apply input; the query constructed never carries them (Doc 13 §272) | API, unit, database |
| Mass assignment | Existing: protected fields in Apply input rejected (`apply-validation-http.test.js`); added where absent: the database shows nothing persisted, and the Jobs provisioning path (Doc 13 §273; Doc 09 §28) | API, database |
| Request size | JSON > 100 KB → `413`; multipart over its limits → `413`; **the early-answer discard bounded and measured** (WP2) | API, integration |
| File spoofing | Executable renamed `.pdf`; PNG renamed `.pdf`; ZIP renamed `.docx`; MIME mismatch; zero-byte; > 5 MiB → rejected with the documented codes (Doc 13 §274–277; Doc 17 §116–122) | API, unit |
| Path traversal | `../../resume.pdf` and encoded variants never control a path; route values cannot escape scope (Doc 17 §123, §136) | Unit, storage |
| Rate limit | Threshold crossing → `429`, legitimate state intact (Doc 17 §139) | API |
| Safe errors | Forced unexpected exception → `INTERNAL_ERROR` with request id; no stack, URI, path, key or credential (Doc 13 §280) | API |
| Private storage | No public route or static path; no storage key in responses; confinement (Doc 13 §278–279) | Storage, API |
| Log redaction | Synthetic markers in sensitive fields absent from production-style logs (Doc 13 §281) | Integration |

Output (§142): unit, integration, API, storage and negative results with counts; the coverage diagnostic; the owner's Windows + MongoDB results; every defect found, its fix and the rerun of the original failing test.

## 10. Dependencies and external inputs

| Input | Needed for | Status |
| --- | --- | --- |
| B6 acceptance, `b6-work` push, B7 authorisation | Starting B7 | Pending |
| The owner's Windows + MongoDB run | Database suites; §143 evidence | At B7 evidence time |
| Scope decision: orphan reconciliation in B7 or C6 (WP7) | WP7 | Owner decision |
| Whether R3, D2b and the message copy enter B7 | Separate changes | Owner decisions (PROPOSED items) |
| Suppression, only if authorised in B7: design approvals (storage choice, key lifecycle, operator identifiers), the HMAC key placed by the owner, the protected key-copy location, the SUP-22 key-integrity design | G-SUP | Key-copy location **AWAITING INPUT**; the rest owner decisions |
| Developer Mode or elevation on Windows | The one never-executed test (optional) | Owner's choice |

**Outside B7:** production deployment, HTTPS and production CORS origins (Release C); the malware scanner and the production storage provider (AWAITING INPUT; C6); a multi-instance rate-limit store (C6); Admin authentication (Release E).

## 11. Review

At the end of B7: stop, produce the Doc 17 / Doc 18 §356 review package, report READY or NOT READY FOR GPT REVIEW, and wait. Claude does not declare B7 approved.
