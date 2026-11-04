# B7 — security and failure test matrix (Doc 18 §§141–143)

| | |
| --- | --- |
| Milestone | Release B — **B7 Backend Security, Failure & QA Gate** (authorised by OD-2026-11-04-01) |
| Branch | `b7-work`, from the accepted and published `b6-work` head `2b00a62` |
| Purpose | Map every Phase 1 backend security requirement to the tests that execute it. A listed test is evidence only through an execution record (§4), not by existing. |
| Sources | Doc 13 §§270–281 (Phase 1 security tests), §§44–47, 52–56, 237–240, 244–247, 289–291; Doc 17 §§116–139; Doc 18 §§141–143 |

**Status legend.** **EX** — executed in the offline suite on 2026-11-04 (Linux sandbox, Node 24.21.0): 60 files, 2,305 passed, 1 skipped (a Windows-only case), 0 failed. **DB** — in the real-MongoDB suite (`tests/db`); **not run in the sandbox** (no MongoDB there); it needs the owner's Windows + MongoDB run of `verify:b7`. **OUT** — not a B7 backend item, with the reason and owning milestone. Test references are `file:line` with the test title shortened.

## 1. Doc 18 §141 — the eight B7 security items

| §141 item | Governing text | Tests | Layer | Status |
| --- | --- | --- | --- | --- |
| **NoSQL injection** | Doc 13 §§44–46, 272; Doc 17 §132; threat T01 | `b7-injection-negative.test.js` (**new**, 28): `$ne`, `$gt`, `$where` as bracketed and bare Jobs query keys → 422, no lookup; operator-object slugs → 404, no lookup; operator-named multipart fields → 422, nothing kept; operator objects as screening answers → 422, nothing kept; operator-shaped text stored byte for byte as text. Existing: `jobs-validation.test.js:57` (object-shaped values), `:116` (`{ $ne: null }` slug); `jobs-http.test.js:375` (`%7B%22%24ne…`, `%24where` slugs never reach the database), `:534` (slug bound by `$eq`); `jobs-dto.test.js:266` (filter from fixed operators only); `apply-validation-http.test.js:218` (`{ $ne: null }` answer), `:307` (`{"$gt": ""}` kept as text); `db/jobs-api.test.js:249` (`?page[$gt]`, `?slug[$ne]` against MongoDB) | API, unit, DB | EX; `db/jobs-api` DB |
| **Mass assignment** | Doc 13 §§47, 273; Doc 17 §137; Doc 09 §28 | `apply-validation-http.test.js:147` (`status: SELECTED`, `scanStatus: CLEAN`, `jobId`, `submittedAt`, `storageKey`, `notifications`, `idempotencyKey`, `__proto__` → 422 and nothing kept); `resume-intake-http.test.js:361` (`scanStatus=CLEAN` refused, CLEAN never recorded), `:371` (`storageKey`, `status`, `jobId`, `__proto__`, `constructor`); `apply-units.test.js:72` (`__proto__` cannot pollute); `models.test.js:255` (unknown fields rejected), `:303` (`scanStatus` defaults to NOT_SCANNED); `models.test.js:537`, `:661` (write guards refuse lifecycle and notification updates); `jobs-dto.test.js:77` (`__proto__`, `hasOwnProperty` currency) | API, unit | EX |
| **Request size** | Doc 13 §§55–56; Doc 17 §§121, 138; Doc 09 §26 | `errors.test.js:89` (JSON > 100 KB → controlled 413), `:102`; `apply-validation-http.test.js:402` and `resume-intake-http.test.js:253` (5,242,881 bytes → 413 FILE_TOO_LARGE, nothing kept), `:145` (exactly 5 MiB accepted); `apply-validation-http.test.js:138` (field over its bound → 422); `upload-abort-limits.test.js:76` (declared length → 413 before reading), `:90` (chunked overflow cut off), `:155`; `staged-close.test.js:252`, `:289`. **Early-answer discard (former OPEN item):** `b7-http-bounds.test.js` (**new**, 14) — Connection: close only when the body is unread, every sent byte read before closing, the 8 MiB cap, the 2 s idle bound, a pipelined request never processed, the explicit timeouts; `apply-connection.test.js` (rewritten for B7, 11) — the general 429 now closes in stages within the staged-close bounds; `server.test.js` (startServer applies `SERVER_TIMEOUTS`) | API, integration, socket | EX |
| **File spoofing** | Doc 13 §§57–68, 274–277; Doc 17 §§116–122; threat T02 | `resume-intake-http.test.js:130` (valid PDF / DOCX accepted), `:163` (`.exe`, `.png`, `.doc`, `.docm`, `.dotx`, no extension, `resume.pdf.exe`), `:178` (disallowed MIME), `:188` (no Content-Type), `:194` (extension / MIME mismatch → 415), `:211` (**executable renamed .pdf**, **PNG renamed .pdf**, DOCX renamed .pdf, truncated PDF, PDF+ZIP polyglot, **arbitrary ZIP renamed .docx**, executable / legacy .doc / OLE2 / .docm / template / spreadsheet / ODF / PDF renamed .docx → 422), `:235` (VBA project), `:245` (**zero-byte**), `:309` (bidirectional-override name); `resume-inspection.test.js`, `docx-xml-structure.test.js`, `pdf-xref-structure.test.js` (structure units) | API, unit | EX |
| **Path traversal** | Doc 13 §254; Doc 17 §§123–124, 136 | `resume-intake-http.test.js:263` (`../../resume.pdf`, `..\..\`, `C:\Windows\…`, `/etc/passwd/../`, UNC → base name only), `:286` (255-character bound), `:294` (Persian, Japanese, NFD, emoji names preserved, NFC); `apply-validation-http.test.js:411` (a dangerous filename never controls the storage path); `resume-filename.test.js:76`, `:94`; `private-storage.test.js:152`, `:205`, `:541` (generated 256-bit keys only); `storage-link-confinement.test.js` (links and junctions refused, POSIX here, Windows owner-run); `b7-orphan-reconciliation.test.js:73` (a per-object link out of storage is never followed); `jobs-http.test.js:375`, `:414` (route values cannot escape scope) | API, unit, storage | EX (the Windows-only case `storage-link-confinement.test.js:327` is skipped on Linux) |
| **Rate limit** | Doc 13 §§52–54; Doc 17 §139 | `security.test.js:92` (safe 429), `:113` (RateLimit headers), `:118` (health exempt); `jobs-http.test.js:176`; `apply-failures.test.js:728` (11th Apply → 429; nothing created by it); `apply-connection.test.js` (the 429 with an unread body closes in stages; a new connection is served after the window) | API | EX. In-process counter: the multi-instance store is C6 (Doc 13 §54) |
| **Safe errors** | Doc 13 §§237–240, 280; Doc 09 §§22, 25 | `errors.test.js:114`, `:126` (no stack, path, credential or connection string), `:145`, `:153` (request id), `:159`, `:184`, `:214`, `:232`, `:251`; `safeError.test.js` (fixed type table and code allowlist; no message, stack or cause); `server.test.js:413`, `:456`; `jobs-http.test.js:288`, `:488`; `apply-failures.test.js:268`; `health.test.js:55`, `:98` (no infrastructure detail; failing dependency never named) | API, unit | EX |
| **Private storage** | Doc 13 §§278–279; Doc 17 §§125–126; threat T03 | `b7-public-resume-denial.test.js` (**new**): after a real Apply, no probe path returns the object and neither the answer nor the replay carries its key; `private-storage.test.js:508` (no HTTP fetch by key or path), `:532` (no key or path in failure messages), `:400`; `storage-link-confinement.test.js:99` (a "public" location refused); `apply-failures.test.js:155`, `:173` (storage failure → 503, nothing kept); `b7-orphan-reconciliation.test.js` (**new**, 23); `db/b4-resume-persistence.test.js:90`, `:116`; `db/b7-storage-reconcile.test.js` (**new**) | API, storage, DB | EX; `db/*` DB |

## 2. Doc 13 §270 — the remaining Phase 1 security tests

| Item | Tests | Status |
| --- | --- | --- |
| HTTPS production | Live HTTPS, certificate and production headers | **OUT** — C6/C7 deployment (Doc 17 §§143–144); no deployment is authorised |
| Security headers | `security.test.js:13` (Helmet set), `:25` (on errors too); `jobs-http.test.js` `expectJobsHeaders` (nosniff, `default-src 'none'`, no `x-powered-by`, no-store) | EX (production verification C6) |
| Jobs input validation | `jobs-validation.test.js` (defaults, caps, repeated parameter refused, `:52`), `jobs-http.test.js:121`, `:375`, `:396` | EX |
| Unexpected fields | `apply-validation-http.test.js:147`; `resume-intake-http.test.js:340`, `:371`; `models.test.js:255`; `b7-injection-negative.test.js` | EX |
| Invalid Job state | `apply-validation-http.test.js:330` (unknown / malformed slug), `:342` (DRAFT, ARCHIVED, future), `:354` (CLOSED, closesAt passed or equal), `:366`; `apply-failures.test.js:56` (closed during storage → 409, object removed); `jobs-http.test.js:337`, `:347`, `:355` | EX |
| Idempotency | `apply-validation-http.test.js:44` (key required); `apply-http.test.js:206` (replay), `:252` (after closing), `:270` (refused file not replayed), `:284` (not notified again), `:329` (concurrent, different content → 409); `db/b5-apply.test.js` | EX; DB |
| Malicious / invalid file formats | §1 "File spoofing" | EX |
| Public resume denial | §1 "Private storage" | EX |
| Log redaction (Doc 13 §281) | `b7-log-redaction.test.js` (**new**, 3): synthetic markers in name, email, phone, message and filename absent from the logs on 201, 422 and a storage failure (503); existing: `errors.test.js:184`, `:232`; `apply-failures` `expectNoStorageKeyInLogs`; `b6-notification-service.test.js` (notification logs) | EX |

## 3. Doc 17 §§131–139 and related threats

| Item | Tests | Status |
| --- | --- | --- |
| §132 NoSQL injection | §1 | EX |
| §§133–134 XSS / event attributes | The backend stores and returns such text unchanged as JSON data (`apply-validation-http.test.js:307` keeps `<script>alert(1)</script>` byte for byte) under `nosniff` and `default-src 'none'`; email templates escape it (`b6-notification-service.test.js:93`, `b6-stage2-templates.test.js:283`). Inert **rendering** is tested where it is displayed | Backend part EX; rendering **OUT** — Release C pages (C1–C3, C5) |
| §135 Open redirect | No redirect surface exists: no `res.redirect`, `returnTo` or redirect parameter in `backend/src` (code search, 2026-11-04) | **OUT** until a redirecting flow exists (Admin sign-in, Release E) |
| §136 Path traversal | §1 | EX |
| §137 Mass assignment | §1 | EX |
| §138 Request size | §1 | EX |
| §139 Rate limit | §1 | EX |
| Doc 13 §244 Method confusion | `jobs-http.test.js:168` (POST / PUT / PATCH / DELETE → canonical 404, no write surface), `:162` (HEAD), `:239`; `errors.test.js:52` | EX |
| Doc 13 §245 Parameter pollution | `jobs-validation.test.js:52` (a repeated parameter is refused, not chosen); `apply-validation-http.test.js:421` and `resume-intake-http.test.js:321` (two files → 422) | EX |
| Doc 13 §246 Prototype pollution | `apply-units.test.js:72`; `apply-validation-http.test.js:147`; `resume-intake-http.test.js:371`; `jobs-dto.test.js:77` | EX |
| Doc 13 §247 Regex DoS | No user-supplied regex; slug and field patterns are anchored and length-bounded first (`jobs-http.test.js:375` 121-character slug; `apply-validation-http.test.js:138`) | EX (bounds); no search surface in Phase 1 |
| Doc 17 §127 Malware state | `resume-intake-http.test.js:361`; `models.test.js:303` — no scanner result never becomes CLEAN | EX. The scanner itself is AWAITING INPUT (C6) |

## 4. Doc 18 §143 — Release B completion gate

| Gate item | Evidence | Status |
| --- | --- | --- |
| Starts successfully | `server.test.js` (startup, timeouts, shutdown); `db/server-lifecycle.test.js:43`, `:97`, `:117` (production mode against the test database) | EX; DB |
| Database connects | `db/database.test.js:87`, `:94` (indexes) | DB |
| Jobs API works | `jobs-http.test.js`; `db/jobs-api.test.js` | EX; DB |
| Apply API works | `apply-http.test.js`; `db/b5-apply.test.js`; `db/b5-apply-server.test.js` | EX; DB |
| Validation works | `apply-validation-http.test.js`; `resume-intake-http.test.js`; `jobs-validation.test.js` | EX |
| Negative paths work | §§1–3 | EX |
| Persistence works | `db/b5-apply.test.js`; `db/restart-persistence.test.js`; `db/b5-apply-server.test.js:218` (process restart) | DB |
| Private storage works | §1; `db/b4-resume-persistence.test.js`; `db/b4-storage-lifecycle.test.js` | EX; DB |
| Idempotency works | §2 | EX; DB |
| Partial failure works | `b6-apply-notifications.test.js:87`, `:99`; `apply-failures.test.js`; `db/b6-notifications.test.js` | EX; DB |
| Tests pass | Offline 2,305 passed / 1 skipped / 0 failed (EX). The real-database suite and the full `verify:b7` | **Pending the owner's Windows + MongoDB run** |

## 5. Coverage diagnostic (Doc 17 §§53–56; Doc 18 §142)

Offline suite, `npm run test:coverage` (v8), 2026-11-04: lines 76.24 %, statements 75.47 %, functions 83.61 %, branches 75.69 %. This is a **diagnostic, not a threshold**. It excludes the real-database suite, and the operator scripts run as child processes are not instrumented (they show 0 % although their tests execute them). Doc 17 §55 areas: `application.notifications.js` 100 % lines, `application.validation.js` 97.65 %, `application.submission.js` 92.72 %, `localPrivateStorage.js` 89.3 %, `orphanReconciliation.js` 100 %, `stagedClose.js` 93.9 %, `serverTimeouts.js` 100 %, `env.js` 100 %.

## 6. Recipient suppression (added with review package r2; OD-2026-11-04-02)

| Control | Governing text | Tests | Status |
| --- | --- | --- | --- |
| Confirmed invalid recipients are not acknowledged again; acceptance, the internal notification and replay are untouched | Doc 14 §120; design rev 8.1 §3.2; SUP-1…15 | `db/b7-suppression-register.test.js` (20) | EX on MongoDB 8.0.23 (replica set, fail points) |
| Fail closed on any key or coverage doubt; key-material integrity; verified rotation; controlled recovery; SUP-21 correction | Design §4.2, §4.4, §4.5.1; SUP-16, 18–23 | `db/b7-suppression-keys.test.js` (19), mutation-checked | EX |
| Secrets never echoed or serialised; no address, digest, key or check value in logs, output or the register | Doc 13 §§112–121; SUP-6, SUP-22f | `b7-suppression-units.test.js` (16), `db/b7-suppression-cli.test.js` (2), SUP-6 | EX |
| Production acknowledgements refused (G-SUP) | OD-2026-11-02-03 item 5; OD-2026-11-04-02 §4 | `b7-acknowledgement-gate.test.js` (5) | EX |

The full SUP-to-test mapping is in `docs/review/B7_REVIEW_PACKAGE_R2.md` §7. Six fail-point cases report NOT RUN on a MongoDB server without `enableTestCommands`; that package §9 gives the optional Windows step that runs them.

## 7. Recipient suppression — r3 review corrections (design rev 8.2 §9; PROPOSED)

| Control | Governing text | Tests | Status |
| --- | --- | --- | --- |
| A consistent authorisation view: no key move or alias prune between the two send-path reads yields an acknowledgement to a suppressed address, for any sender keyring or read order | Design §3.2, §4.4, §9.1; SUP-24 | `db/b7-suppression-consistency.test.js` (18 interleavings, 2 controls, 1 alias case); mutation-checked (alias replaced; quiet period removed; coverage from the primary lookup only) | EX on MongoDB 8.0.23 (replica set) |
| Bounded, resumable `rekey` / `recover-key`: an unresolved prefix never blocks later entries; interruption and resumption | Design §3.4, §4.2, §9.2; SUP-25 | `db/b7-suppression-consistency.test.js` (2; fail points); mutation-checked (cursor ignored) | EX |
| No fixed maximum on verify-only keys; only the input length is bounded, refused without echo | Design §3.2 step 2, §9.3 | `b7-suppression-units.test.js` (1) | EX |
| History cap on the duplicate-report and re-apply paths (dry run and `--apply`); alias pruning writes no history | Design §3.1, §9.5; SUP-13b | `db/b7-suppression-consistency.test.js` (3); mutation-checked (cap check removed) | EX |
| The SUP-6 data-inventory entry lists every stored field; undecided production inputs marked AWAITING | Doc 13 §§197–198; design §9.4; SUP-6 | `b7-suppression-inventory.test.js` (5); mutation-checked (a field removed from the inventory) | EX |

Results and the mapping: `docs/review/B7_REVIEW_PACKAGE_R3.md`.
