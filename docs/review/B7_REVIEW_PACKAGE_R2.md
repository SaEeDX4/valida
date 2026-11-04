# B7 — review package r2: recipient suppression implemented (OD-2026-11-04-02)

| | |
| --- | --- |
| Milestone | Release B — **B7 Backend Security, Failure & QA Gate** |
| Supersedes | [`B7_REVIEW_PACKAGE.md`](B7_REVIEW_PACKAGE.md) (r1, 2026-11-04). r1 stays as the record of the B7 core, which GPT inspected: eight focused files, 133 passed, Linux / Node 24.22.1. |
| Authorised by | OD-2026-11-04-01 (B7) and **OD-2026-11-04-02** (suppression design rev 8 approved: S1 keyed HMAC; S2–S6; SUP-21 correction) — [`OWNER_DECISION_2026-11-04-02_B7_SUPPRESSION_APPROVAL.md`](OWNER_DECISION_2026-11-04-02_B7_SUPPRESSION_APPROVAL.md) |
| Branch | `b7-work` — local only. Not pushed, not merged, not deployed. |
| Base | `2b00a6288ae8c1037dfa972c56c45ec94816e44d` — the published `b6-work` head |
| Status | **READY FOR GPT REVIEW.** The implementation and all sandbox evidence are complete on `b7f8d60`, and the test-only commit `14fa751` follows it. The Windows / MongoDB verification is held until after GPT review, as instructed (§9). Claude does not declare B7 accepted. G-SUP stays closed, and production candidate acknowledgements stay refused. |

## 1. Commits (each separately traceable; all SSH-signed by the session key)

| # | Commit | Kind | What it contains |
| --- | --- | --- | --- |
| 1 | `c047ef2f027aabb01a13ace9ed4ce1893ab6ea9d` | code | B7 core: bounded early-answer discard, explicit timeouts, storage reconciliation, security matrix |
| 2 | `9e86465ab3c69ab998ed5d1c825e52bf58e4ca9b` | code | Production refusal of acknowledgements (G-SUP); suppression design rev 7 |
| 3 | `3a17e035258e2efee8133b2c8be01f50aa8f493f` | docs | r1 review package and the pre-implementation report |
| 4 | `6b8e9ca802d8f40acde97a30989ada166b697005` | docs | Suppression design rev 8 and the decision proposal (GPT's focused review) |
| 5 | `611ecdb7d5f93c8367df463141585d3b4e3215ef` | docs | Decision record OD-2026-11-04-02 |
| 6 | `b7f8d605500e372b6d7e360c6d753e10e7f85b40` | code | **Suppression implementation and its tests** — the commit every result below was run on |
| 7 | `14fa7518359511b2b0bdc88e0d9162d11ded78af` | test | Asserts the retry command's new coverage line (`db/b6-notifications` 16 / 16) |
| 8 | the bundle's HEAD | docs | This package and the security-matrix addendum. It cannot name its own SHA: the HEAD is reported with the bundle. |

The full chain is in the Git bundle `valida-b7-work.bundle`, which is not a push. See §9.

## 2. Approval record

- **OD-2026-11-04-02**, the next free identifier after OD-2026-11-04-01.
- **S1:** keyed HMAC, approved.
- **S2–S6:** approved, with the **SUP-21 correction**: releasing source-less entries never restores eligibility while any key is `RECOVERING`.
- The design header is now rev 8.1, APPROVED and implemented; the corrected SUP-21 text is in design §8.
- Plan B.1: preconditions 3 and 5 are met. Precondition 4 (production key placement) is a C6 owner action.

## 3. Changed files (`6b8e9ca` → `b7f8d60`: 38 files, +3,845 / −85; 14 added, 24 modified, none deleted)

| Area | Files |
| --- | --- |
| **New modules** | `src/modules/suppression/suppressionKeys.js` — HMAC digest and check value, constant-time comparison, a keyring that never serialises bytes |
| | `src/modules/suppression/suppressionRegister.js` — bounded reads; durable, version-conditional writes |
| | `src/modules/suppression/suppressionGate.js` — coverage decision and send-path check |
| | `src/modules/suppression/suppressionOperations.js` — every operator subcommand |
| | `src/models/RecipientSuppression.js` — both collections, bounds, append-only history, key-state invariants |
| **New script** | `scripts/ops-notifications-suppression.mjs` (+ npm script `ops:notifications:suppression`) |
| **Changed source** | `src/config/env.js` — five variables, secret-safe |
| | `src/app.js` — the gate is a dependency of the notifier |
| | `src/modules/applications/application.notifications.js` — the check after the claim; `lastStatusCode` |
| | `src/modules/applications/application.repository.js` — `lastStatusCode` cleared at the claim, recorded with the outcome |
| | `src/models/Application.js` — the channel field `lastStatusCode` |
| | `src/integrations/notifications/notificationService.js` — three codes and their classes |
| | `src/db/indexes.js` — four register indexes |
| **Changed scripts** | `notifications-retry.mjs` — the same check, plus a coverage line |
| | `notifications-smoke.mjs` — a per-run synthetic key in the disposable test database, removed afterwards |
| | `verify-b7.mjs` — adds the suppression units |
| **Tests (new)** | `tests/b7-suppression-units.test.js` |
| | `tests/db/b7-suppression-register.test.js` |
| | `tests/db/b7-suppression-keys.test.js` |
| | `tests/db/b7-suppression-cli.test.js` |
| | `tests/fixtures/suppressionDoubles.js`, `tests/db/fixtures/suppression.js`, `tests/db/fixtures/suppressionHarness.js` |
| **Tests (adjusted)** | `apply-units`, `b6-apply-notifications`, `b6-notifier`, `b6-notification-service`, `indexes`, `db/b6-notifications`, `db/database`, `fixtures/applyHarness`. Two reasons: the new `lastStatusCode` field in exact state comparisons, and passing a complete-coverage gate where a B6 test is not about suppression. No assertion was weakened. |
| **Docs** | `backend/README.md` (Recipient suppression section), `backend/.env.example`, the design (rev 8.1), plan B.1, the decision proposal outcome, the decision record |

## 4. Contract changes

**Packages.** None. `package-lock.json` is unchanged.

**Environment variables (new):**
- `SUPPRESSION_HMAC_KEY` (secret)
- `SUPPRESSION_HMAC_KEY_ID`
- `SUPPRESSION_HMAC_PREVIOUS_KEYS` (secret)
- `SUPPRESSION_OPERATOR_IDS`
- `SUPPRESSION_LOOKUP_TIMEOUT_MS` (default 2,000)

No value is ever echoed or serialised.

**Database.** These are the approved Doc 10 additions.
- **`recipient_suppressions`** — lookup `{keyId, digest}`, scope, state, reason, basis, bounded sources (≤ 10), duplicate count, append-only history (≤ 20), `version`.
- **`recipient_suppression_keys`** — `_id` = key id, check value, state `ACTIVE`/`RECOVERING`/`RETIRED`, recovery record, `version`.
- **Indexes** — four: unique `suppression_lookup_unique`, `suppression_state_updatedAt`, `suppression_sourceApplication`, `suppression_coverage`. The required set grows from 6 to 10. `npm run db:indexes:apply` creates them; `add` refuses with `INDEXES_MISSING` until the unique one exists.
- **`applications`** — the channel field `notifications.*.lastStatusCode`.
- No data migration: existing documents read the field as `null`.

**API.** No route, status code or envelope changed. New stored codes:
- `RECIPIENT_SUPPRESSED` — PERMANENT
- `SUPPRESSION_CHECK_UNAVAILABLE` — TRANSIENT
- `SUPPRESSION_COVERAGE_INCOMPLETE` — CONFIGURATION

**Behaviour change to note.** Outside production, an enabled acknowledgement now needs a configured and registered suppression key; otherwise it fails closed with `SUPPRESSION_COVERAGE_INCOMPLETE`. **In production, `APPLICATION_ACKNOWLEDGEMENT_ENABLED=true` is still refused outright** (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`, unchanged; re-tested in §6).

## 5. Implementation choices inside the approved design (for GPT review)

1. **`recover-key --reason LOST|UNTRUSTED`** is required on the first run. It fills `recovery.reason` (§4.5.1), a flag the §3.4 table did not list.
2. **"Has a usable source"** means one listed source whose Application still exists. One rule is used for `rekey`, `recover-key`, `resolve-unrecoverable` and `lift --reason SUPERSEDED`.
3. **`resolve-unrecoverable`** does not itself require a `RECOVERING` key. While one is `RECOVERING`, sending stays blocked through the coverage rule (the SUP-21 correction), and `--complete` is required.
4. **Duplicate reports** stop adding history at 17 entries (`MAX_HISTORY − 3`), keeping slots for a lift, rekey or release. At 20, every further action is refused.
5. **An Application without a stored `emailNormalized`** cannot be checked, so it fails closed (`SUPPRESSION_CHECK_UNAVAILABLE`).
6. **Coverage reads accept at most 1,000 key ids or key documents.** More than that is treated as incomplete (`COVERAGE_READ_LIMIT`).
7. **`add --from-bounce`** uses a 7-day default window (at most 30), at most 5,000 candidate Applications, and 5 minutes of clock skew. The address comes only from the single matched Application.
8. **History is append-only by content.** A removed or rewritten entry fails validation, not only a shorter array.
9. **`add --complaint`** is operator-attested only, as designed. No `SENT` precondition was added.
10. **The live smoke run** registers its own per-run random key in the disposable test database and deletes that record at the end. No real key is involved, and the smoke still needs `--confirm-live-email`. It was not run.

## 6. Test execution

**Environment.**
- Linux sandbox.
- Node 24.21.0.
- MongoDB **8.0.23**: the conda-forge build, SHA-256 `029796af…1df5a37`, the same 8.0 series as the owner's 8.0.9.
- Run as a disposable **single-node replica set** with `enableTestCommands=1`, which provides real server-side `failCommand` fail points.
- Plus one **standalone** server without test commands, to match the owner's likely Windows setup.
- SMTP: the real SMTP adapter against the repository's local SMTP test server (TLS, test certificate), which counts RCPT commands and accepted messages.
- Synthetic data and keys only. Nothing left the machine.

**Final gate — `npm run verify:b7` on `b7f8d605500e372b6d7e360c6d753e10e7f85b40`, clean tree, `MONGODB_TEST_URI` = replica set: `B7 VERIFICATION PASSED`, exit 0.**

| Gate | Result |
| --- | --- |
| Node.js 24 | PASS |
| `verify:b6` | PASS (exit 2: live-provider gate PENDING by design; B6 accepted on live evidence) |
| — offline suite B1–B7 | 61 files: 2,325 passed, 1 skipped (Windows-only), 0 failed |
| — B6 / B5 / B4 acceptance gates | 460 / 236 / 584 passed (1 skipped), 0 failed |
| — engine check, index apply and check | MongoDB 8.0.23; **10 / 10** required indexes, including the four register indexes |
| — real-database suite B2–B7 | **18 files: 188 passed, 0 failed** (includes the three SUP files) |
| — B6 database gate; live-procedure rehearsal | 16 / 16; 17 / 17. The smoke rehearsal now passes the real suppression check with its own synthetic key. |
| B7 acceptance gate (offline, 13 files) | 244 passed, 1 skipped, 0 failed |
| Coverage diagnostic (offline) | lines 71.76 %, statements 70.45 %, functions 76.83 %, branches 70.10 % — no threshold |
| `npm audit --omit=dev` | 0 vulnerabilities |

Offline coverage fell from 76.24 % (r1) because `suppressionOperations.js` and `suppressionRegister.js` are exercised only by the real-database suites, which the offline diagnostic excludes. Measured under the SUP database suites:

| Module | Lines | Branches |
| --- | --- | --- |
| `RecipientSuppression.js` | 100 % | 81.6 % |
| `suppressionGate.js` | 95 % | 77.8 % |
| `suppressionOperations.js` | 96.1 % | 79.7 % |
| `suppressionRegister.js` | 90.9 % | 62.2 % |
| `suppressionKeys.js` | 79.2 % (100 % offline) | 54.7 % |
| **Total** | **94.28 %** | **75.61 %** |

**Per-test SUP run on `b7f8d60`** (JSON reporter; the gate log has file totals only):
- offline: 21 / 21 — `b7-suppression-units` 16 and `b7-acknowledgement-gate` 5;
- replica set: **41 / 41** — register 20, keys 19, cli 2. No skips: every fail-point case ran.

**Standalone MongoDB 8.0.23, no test commands** (owner-like): SUP database files plus `db/b6-notifications` gave **51 passed, 6 skipped**. The six skips are exactly the fail-point cases, each reporting `NOT RUN: mongod without enableTestCommands`:
- SUP-11 read failure, timeout and failed add;
- SUP-14 killed write;
- SUP-19;
- SUP-23c/d.

Every other test passes on a standalone server too.

**After the test-only commit `14fa751`:** `db/b6-notifications` 16 / 16. It adds the assertion for the retry command's new coverage line.

**Mutation checks.** Each control was disabled, its tests run, then the code restored (clean tree confirmed).

| Disabled control | Tests that failed |
| --- | --- |
| `RECOVERING` blocks coverage (the SUP-21 correction) | SUP-21 correction test, 23a, and the coverage unit |
| `key-register`'s "id already has entries" refusal | SUP-22g |

**Manual / external verification.** None. No live email, provider, DNS, deployment or production change. There are no screenshots: there is no UI.

**Known defects.** None open.

## 7. SUP requirement → test mapping (results from the final run on `b7f8d60`)

Results: **PASS** = executed and passed on the replica set (`b7f8d60`). A **standalone** label marks the cases that need fail points and report NOT RUN on a standalone server. Files are under `backend/tests/`.

| SUP | Requirement (design §8, rev 8.1) | Test(s) | Result |
| --- | --- | --- | --- |
| 1 | 5.1.1 RCPT refusal registered → a distinct Application: 201; acknowledgement `RECIPIENT_SUPPRESSED`; **zero** submissions; internal sent | `db/b7-suppression-register` › SUP-1. Counter: RCPT for the address stays at 1, messages 0; HR +1; `lastStatusCode` 5.1.1 stored; log has ids only | PASS |
| 2 | Same via `add --from-bounce` (token, eligible status, `SENT` acknowledgement) | › SUP-2 | PASS |
| 3 | 4.x.x, 5.2.2, `TIMEOUT`, `OUTCOME_UNKNOWN`, stale attempt never suppress | › SUP-3. Real 552 5.2.2 and 450 4.2.1 relay replies; stored uncertain codes; bounce outside the window; register count 0 | PASS |
| 4 | Acceptance, internal notification, replay and idempotency untouched | › SUP-4 (replay 200 with the same body, zero extra RCPT); `b7-suppression-units` › notifier fails closed | PASS |
| 5 | `lift`: operator, reason, evidence; history; **no resend** under any retry flag; a later Application acknowledged | › SUP-5. Four retry-flag combinations; RCPT unchanged | PASS |
| 6 | No address or digest in logs or the register; `forget` (retention / privacy) | › SUP-6. Raw register JSON and logs scanned for address, local part, digest and check value | PASS. **Partly open:** no data / provider inventory document exists in the repository yet (Doc 13 §§197–198); the register's entry is due when it is created |
| 7 | Sender-side failures never suppress | › SUP-7. A real 550 5.7.1 at RCPT (`PROVIDER_REJECTED`); MAIL FROM, auth, rate and 4.x as stored outcomes | PASS (MAIL FROM / auth / rate through stored states, not live relay replies) |
| 8 | Duplicates idempotent; concurrent adds → one document | › SUP-8. `ALREADY_ACTIVE` with no version change; REAPPLY; two concurrent adds → `ADDED` + `DUPLICATE`, one document with both sources | PASS |
| 9 | Uncorrelated or conflicting evidence cannot suppress | › SUP-9 (no match, internal-channel match, not `SENT`, missing / ineligible status, future and out-of-window times, a refusal without an enhanced status); `b7-suppression-units` › MULTIPLE_MATCHES | PASS (MULTIPLE_MATCHES via a stub read: unreachable with real ids) |
| 10 | Only case and outer whitespace merge | › SUP-10 (through Apply); units › no folding | PASS (non-ASCII at digest level: the B2 validator governs acceptance) |
| 11 | **(corrected)** Read failure / timeout → `SUPPRESSION_CHECK_UNAVAILABLE` (TRANSIENT; a normal retry rechecks); **missing key → `SUPPRESSION_COVERAGE_INCOMPLETE`** (CONFIGURATION; only `--include-configuration`); 201; internal unaffected; failed add leaves nothing | › SUP-11 ×4. Real server error and server-held timeout via fail points; keyless gate | PASS (3 cases NOT RUN on standalone) |
| 12 | Lookup after a committed add → suppressed; an earlier lookup → submitted **once**, never recalled | › SUP-12. In-flight send held after its lookup; exact counts: messages 1, RCPT 2 | PASS |
| 13 | Unknown operator, no `--apply`, bad or "@" evidence, history cap | › SUP-13 | PASS |
| 14 | Durable (`w: majority, j: true` on every register write, by command monitoring); killed write → unchanged or complete; re-run once; version conflicts retried; history never rewritten | › SUP-14 ×2. Fail point closes the connection for the attempt and the driver retry; two concurrent writers both land; pop / rewrite refused | PASS (killed-write case NOT RUN on standalone) |
| 15 | N suppressed Applications → zero acknowledgements, N 201s, N internal | › SUP-15 (N = 5) | PASS |
| 16 | Rotation: verify-only k1 still matched; rekey moves sourced entries; idempotent; source-less stay; k1 not safe to retire; nothing lifted | `db/b7-suppression-keys` › SUP-16 (history `REKEY` / `ROTATION`; zero `SOURCE_UNVERIFIED`) | PASS |
| 17 | Withdrawn (rev 5) | — | — |
| 18 | Missing historical key / replaced lost key → everything blocked; register unchanged; restore → normal; blocked channels only with `--include-configuration` | › SUP-18 | PASS |
| 19 | Interrupted rekey: whole entries; coverage complete; re-runs finish, then no change; mismatch and conflict reported | › SUP-19 (fail point kills the second write) | PASS (NOT RUN on standalone) |
| 20 | Premature retirement → SUP-18 behaviour; resolve refuses sourced entries | › SUP-20 | PASS |
| 21 | **(corrected, OD-2026-11-04-02)** Audited release; and **while a key is `RECOVERING`, release does not restore eligibility** — only `--complete` plus complete coverage | › SUP-21 ×2 (refusals and success; CORRECTION test); units › coverage decision; mutation-checked | PASS |
| 22 | Key-material integrity a–g | › 22a restart, 22b restore (raw dump / re-insert), 22c rotation, 22d missing check, 22e correct material, 22f wrong-length check and output scan, **22g** missing check with K1′ and K1 (mutation-checked) | PASS |
| 23 | Controlled recovery a–f | › 23a, 23b, 23c / 23d (killed after k of n, every stage blocked), 23d version conflict, 23e preserved conflicts and SUPERSEDED, 23f completion and `KEY_NOT_TRUSTED` | PASS (23c NOT RUN on standalone) |
| G-SUP | Production refusal unchanged | `b7-acknowledgement-gate` ×5; units › production refusal with a key configured | PASS |
| CLI | Command as a process | `db/b7-suppression-cli` ×2 (dry run, operator refusal, register, repeat refused, coverage, bad key refused before connecting, no secret printed) | PASS |

## 8. Blockers and open items

| # | Item | Owner | Blocks |
| --- | --- | --- | --- |
| 1 | GPT review of the implementation, in particular the §5 choices and the §4 behaviour change for non-production acknowledgements; then the owner's decision | GPT, then owner | Windows verification, B7 acceptance, push / merge |
| 2 | One Windows + MongoDB verification against the final reviewed commit (§9) | Owner, **after** GPT review | Release B completion gate (§143) on the owner's platform |
| 3 | C6 prerequisites, not blockers to this implementation: the production key in the host secret store; the **protected key-copy location (AWAITING INPUT)**; the production operator tokens | Owner, C6 | Any production acknowledgement |
| 4 | Removing or relaxing the production refusal (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`) after G-SUP evidence is accepted | Separate owner decision | Production acknowledgements |
| 5 | Not run, and not authorised: a live DSN end to end (design §8, "separately authorised later"); a data / provider inventory entry for the register, once that inventory exists (Doc 13 §§197–198) | — | — |

Nothing else is open for B7 in this sandbox.

## 9. Windows / MongoDB verification — to run AFTER GPT review, against the final commit

Use a **separate clone**, so the original workspace and its uncommitted work are never touched. The run is fully synthetic: no email leaves the machine (local SMTP test server only), no production data, no real key.

**1. Get the reviewed commits** (PowerShell):

```powershell
git clone https://github.com/SaEeDX4/valida.git valida-b7-review
cd valida-b7-review
git fetch origin b6-work
git bundle verify ..\valida-b7-work.bundle
git fetch ..\valida-b7-work.bundle b7-work:b7-work
git switch b7-work
git rev-parse HEAD     # must equal the HEAD given with this package
Get-FileHash ..\valida-b7-work.bundle -Algorithm SHA256   # must equal the bundle SHA-256
cd backend
npm ci
```

**2. Main run** — the owner's usual MongoDB 8.0 service (standalone is fine):

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"
npm run verify:b7
echo "exit=$LASTEXITCODE"
```

**Expected result:**
- `B7 VERIFICATION PASSED`, exit 0.
- Inside it, `verify:b6` exits 2 (live gate PENDING by design), which counts as PASS.
- On a standalone server, the 6 fail-point SUP cases **skip** with `NOT RUN: mongod without enableTestCommands`. That is expected there.

**3. Optional — the fail-point cases on Windows** (a disposable replica set; nothing else uses it):

```powershell
New-Item -ItemType Directory "$env:TEMP\valida-b7-rs" | Out-Null
# In a SEPARATE PowerShell window (leave it running; Ctrl+C stops it):
& "C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe" --dbpath "$env:TEMP\valida-b7-rs" --port 27027 --bind_ip 127.0.0.1 --replSet rs0 --setParameter enableTestCommands=1
# Back in the backend folder:
@'
import mongoose from 'mongoose';
const c = await mongoose.createConnection('mongodb://127.0.0.1:27027/admin?directConnection=true').asPromise();
await c.db.admin().command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27027' }] } });
await c.close();
'@ | Out-File -Encoding utf8 rs-init.mjs
node rs-init.mjs; Remove-Item rs-init.mjs
Start-Sleep -Seconds 5
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27027/valida_test?replicaSet=rs0"
npx vitest run --config vitest.db.config.js tests/db/b7-suppression-register.test.js tests/db/b7-suppression-keys.test.js tests/db/b7-suppression-cli.test.js
```

**Expected:** `Tests 41 passed (41)`, no skips. Afterwards, stop `mongod` with Ctrl+C and delete `$env:TEMP\valida-b7-rs`.

**Please return:**
- the `verify:b7` summary block and the exit code;
- the `Test Files` / `Tests` lines it printed;
- any FAIL output;
- for the optional step, its `Tests` line.

Do not send `.env` files, logs that contain configuration, or screenshots of secrets.
