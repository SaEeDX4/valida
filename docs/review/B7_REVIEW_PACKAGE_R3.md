# B7 — review package r3: corrections after GPT's r2 review (design rev 8.2)

| | |
| --- | --- |
| Milestone | Release B — **B7 Backend Security, Failure & QA Gate** |
| Supersedes | [`B7_REVIEW_PACKAGE_R2.md`](B7_REVIEW_PACKAGE_R2.md) (r2, on `b7f8d60` / `14fa751`). r2 is kept **unchanged** as the record of the suppression implementation and its evidence, and r1 ([`B7_REVIEW_PACKAGE.md`](B7_REVIEW_PACKAGE.md)) as the record of the B7 core. This package covers only the five r2 review findings and the evidence run after their fixes. |
| Review input | GPT's focused B7 r2 review (2026-11-04), checkpoint `b7-work` HEAD `51eace23ddc908af06accdab73c4b58f0e6214d6`: five findings (§2). |
| Authorised by | OD-2026-11-04-01 (B7) and OD-2026-11-04-02 (suppression design rev 8 approved). The rev 8.2 corrections (design §9) are **PROPOSED** for GPT review and owner confirmation; they are not yet approved. |
| Branch | `b7-work`, local only. It is not pushed, merged or deployed. |
| Base | `2b00a6288ae8c1037dfa972c56c45ec94816e44d`, the published `b6-work` head. B6 is not reopened. |
| Status | **READY FOR GPT REVIEW.** All five findings are fixed and tested, and the final `verify:b7` passed on `44ab967` (§6.1). The Windows / MongoDB verification is **not** prepared for running yet. As instructed, it will be prepared only after this review is resolved (§9). Claude does not declare B7 accepted. G-SUP stays closed, and production candidate acknowledgements stay refused (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`, re-tested in §6). |

## 1. Commits (all SSH-signed by the session key)

Commits 1–8 are listed in r2 §1; the last of them is `51eace23ddc908af06accdab73c4b58f0e6214d6`, the review checkpoint. The new commits follow it:

| # | Commit | Kind | Finding | What it contains |
| --- | --- | --- | --- | --- |
| 9 | `8bf82195b0b951c510612d190de03bae7a161753` | code + test | 3 | No fixed maximum on verify-only keys; input-length bound; unit test |
| 10 | `a58d4d2983fcfa5d7684f4d5c46fc57336e0b1b4` | code + test | 1, 2, 5 | Lookup aliases and quiet period; bounded resumable passes; history cap on the duplicate path; SUP-24, SUP-25, SUP-13b; key tests adjusted for the quiet period |
| 11 | `ca2c4550ec5eadcdc6d98a4701cb07a6b5aa82e9` | docs + test | 4 | `docs/privacy/DATA_INVENTORY.md`; its drift test, added to the B7 acceptance gate |
| 12 | `44ab967dab663eeaf25444413609e2c3cc46cf8b` | docs | all | Design rev 8.2 (§9 and inline markers), backend README, security matrix §7, docs index. **The commit every result in §6 was run on.** |
| 13 | the bundle's HEAD | docs | — | This package. It cannot name its own SHA, so the HEAD is reported with the bundle. |

Findings 1, 2 and 5 share one commit because they change the same functions in `suppressionOperations.js` (the move, the pass and the upsert). §3 maps each finding to the exact functions changed.

**Diff `51eace2..44ab967`: 19 files, +985 / −148. 3 files added, 16 modified, none deleted.**

| File | + / − | Finding |
| --- | --- | --- |
| `backend/src/models/RecipientSuppression.js` | +53 / −0 | 1 |
| `backend/src/db/indexes.js` | +10 / −3 | 1 |
| `backend/src/modules/suppression/suppressionRegister.js` | +33 / −6 | 1 |
| `backend/src/modules/suppression/suppressionOperations.js` | +201 / −96 | 1, 2, 5 |
| `backend/scripts/ops-notifications-suppression.mjs` | +6 / −4 | 2 |
| `backend/src/modules/suppression/suppressionKeys.js` | +5 / −2 | 3 |
| `backend/src/config/env.js` | +6 / −4 | 3 |
| `backend/.env.example` | +1 / −0 | 3 |
| `backend/scripts/verify-b7.mjs` | +4 / −2 | 4 |
| `backend/tests/db/b7-suppression-consistency.test.js` (new) | +372 / −0 | 1, 2, 5 |
| `backend/tests/db/b7-suppression-keys.test.js` | +20 / −9 | 1 (quiet period in completion steps) |
| `backend/tests/indexes.test.js` | +8 / −6 | 1 (11 indexes) |
| `backend/tests/b7-suppression-units.test.js` | +14 / −0 | 3 |
| `backend/tests/b7-suppression-inventory.test.js` (new) | +71 / −0 | 4 |
| `docs/privacy/DATA_INVENTORY.md` (new) | +77 / −0 | 4 |
| `docs/architecture/RECIPIENT_SUPPRESSION_DESIGN.md` | +72 / −12 | all (rev 8.2) |
| `backend/README.md` | +19 / −4 | 1, 2, 3 |
| `docs/qa/b7/B7_SECURITY_TEST_MATRIX.md` | +12 / −0 | all |
| `docs/README.md` | +1 / −0 | 4 |

The full diff is `git diff 51eace2..44ab967` in the bundle.

## 2. The findings

| # | Finding (GPT r2 review, verbatim) |
| --- | --- |
| 1 | "Fix the inconsistent reads in `suppressionRegister.readForAcknowledgement`. Coverage and matching currently run independently. During k1→k2 migration, an old-keyring sender can observe pre-migration coverage and post-migration absence of a k1 match, returning PROCEED while the address remains suppressed. Establish a consistent authorization view or equivalent synchronization. Add a deterministic real-MongoDB regression with controlled interleaving, different configured keyrings, and zero acknowledgement submissions. Preserve the approved add-versus-send concurrency boundary." |
| 2 | "Add bounded, resumable progress to both `rekey` and `recover-key`. Unresolved records at the start of a batch must not indefinitely prevent processing later eligible records. Preserve unresolved entries and audit history. Test a blocked prefix exceeding the batch limit, interruption, and resumption." |
| 3 | "Reconcile `MAX_PREVIOUS_KEYS = 8` with approved design §3.2, which specifies no fixed maximum. Do not silently rewrite the approved requirement." |
| 4 | "Complete the minimal suppression data-inventory entry required by SUP-6; mark actual production inputs pending where appropriate." |
| 5 | "Check the duplicate-report write path against the approved history-cap rule; it currently permits updates at the cap without `refuseAtHistoryCap`." |

## 3. How each finding was resolved

### Finding 1 — a consistent authorisation view (design §9.1)

**Confirmed.** The defect was real. Under r2, `rekey` replaced an entry's `lookup` in one write. A sender still configured with only `k1` could therefore read coverage before the move (complete) and the match after it (no `k1` entry), and send. Mutation M1 (§6.3) reproduces exactly that: with the old replacement behaviour restored, the old-keyring sender submits to the suppressed address (zero-submission assertion fails).

**Chosen correction: equivalent synchronisation, not a snapshot.** A snapshot read (both reads in one session with `readConcern: snapshot`) would need a replica set and transactions. The owner's MongoDB 8.0 is probably standalone, and the production topology is still AWAITING (C6). Instead the register never lets a key id an entry is matchable under disappear inside one read window:

- **Model** (`RecipientSuppression.js`): new field `lookups: [{ keyId, digest, retiredAt }]` — the primary (`retiredAt: null`, always equal to `lookup`) plus aliases. At most `MAX_LOOKUPS = 8` per entry. A validation hook derives it for new entries and enforces exactly one primary equal to `lookup`, with distinct pairs.
- **Register** (`suppressionRegister.js`): `readCoverageInputs` takes `distinct('lookups.keyId')` over `ACTIVE` entries. `findActiveMatch` matches `lookups: { $elemMatch: { keyId, digest } }` per configured pair. `readForAcknowledgement` is otherwise unchanged: both reads issued together, under one bound.
- **Operations** (`suppressionOperations.js`):
  - `moveLookup` adds the new primary and keeps the old one as an alias stamped `retiredAt`, used by both `rekey` and `recover-key`.
  - `pruneAliases` removes only aliases at least `ALIAS_QUIET_PERIOD_MS = 10 min` old. It is bounded, writes one conditional durable write per entry, and writes no history.
  - `coverage` reports `aliasEntries`; `safeToRetire` needs zero `ACTIVE` entries and zero aliases.
  - `recover-key --complete` prunes that key's old aliases and refuses `ALIASES_PENDING` while any remain.
  - `upsert`, `check` and `keyRegister` look entries up through `lookups` too.
- **Indexes** (`indexes.js`): `suppression_coverage_lookups` `{ state, scope, lookups.keyId }` replaces `suppression_coverage`, and `suppression_lookups_match` `{ lookups.keyId, lookups.digest }` is new. The required set is 11.

**Why it holds.** The full argument is in design §9.1. A `PROCEED` requires both reads to complete within one bound `T` of at most 10 s. A move only adds key ids. A prune removes only aliases at least 10 minutes old. So, whatever the read order:

- a sender that holds any key the entry is matchable under finds the entry;
- a sender that holds none of them sees an unconfigured key id, which is `COVERAGE_INCOMPLETE`.

Two assumptions are stated for confirmation in §9.1: the operator clocks agree within about 9 min 50 s, and an unknown-outcome move is not applied that much later.

**Regression — SUP-24** (`tests/db/b7-suppression-consistency.test.js`). It runs against real MongoDB, through the real app, notifier and SMTP adapter, with the local SMTP counter.

- **Controlled interleaving.** A steered gate runs the two real register reads in a fixed order and executes the key step exactly once, between them. A probe asserts that the step ran.
- **Matrix.** Three sender keyrings (old `{k1}`, both `{k2,k1}`, new `{k2}`) × two read orders × three steps = 18 cases. The steps are:
  - a move `k1→k2`;
  - a move plus an immediate prune attempt;
  - a prune of the `k1` alias after the quiet period, using a later clock.
- **Each case asserts:**
  - **zero RCPT and zero messages** for the suppressed address;
  - the acknowledgement is `FAILED` / `RECIPIENT_SUPPRESSED` or `SUPPRESSION_COVERAGE_INCOMPLETE`;
  - the stored lookups are as expected.
- **Controls.** Two controls (one per read order) prove that the same steered path does acknowledge an unsuppressed address (1 RCPT), so the zero is not vacuous. One further case checks alias retention, the quiet period, that pruning writes no history, and `safeToRetire`.

**Add-versus-send boundary preserved.** The add path, the lift path and the §3.5 rules are unchanged. SUP-12 (`db/b7-suppression-register`) still passes: an in-flight send whose lookup completed before the add is submitted once, and a later lookup is suppressed, with exact counts.

### Finding 2 — bounded, resumable passes (design §9.2)

**Confirmed.** Under r2, each run re-selected the first `--limit` entries not under the current key. Source-less entries, conflicts and mismatches stay in that set forever, so a prefix of them longer than `--limit` stalled every run. Mutation M4 (§6.3) shows this.

**Correction.** `boundedPass` (`suppressionOperations.js`) is used by both `rekey` and `recover-key`:

- it examines at most `--limit` entries in `_id` order after `--after <id>`, and returns `examined` and `nextAfter` (`null` at the end);
- an unknown write carries `resumeAfter`, the last entry fully handled, and the command prints the exact `--after` to use;
- an invalid cursor is refused with `INVALID_CURSOR`;
- the CLI accepts `--after` for both subcommands.

Unresolved entries are not written and keep their history; they are counted in each run that examines them. Every earlier precondition, refusal and count is unchanged.

**Tests — SUP-25** (consistency file), for each of `rekey` and `recover-key`:

- **Setup:** six source-less entries (a blocked prefix), then three eligible entries, with `--limit 5`.
- **Run 1:** examines 5, moves 0, `nextAfter` = the 5th id. Without the cursor the same prefix returns.
- **Run 2:** `--after` with a fail point closing the connection on the second move, which gives `SuppressionWriteUnknown` with `resumeAfter` = the first eligible entry.
- **Run 3:** resumes from it and moves the remaining 2, with `nextAfter: null`.
- **Checks:** each eligible entry has exactly one `REKEY` (`ROTATION`, or `SOURCE_UNVERIFIED` with the decision reference); the six blocked entries are byte-for-byte unchanged (`rekey`) or still `ACTIVE` under `k1` (`recover-key`).

On a server without fail points, the interruption step reports NOT RUN and the resumption is still tested.

### Finding 3 — `MAX_PREVIOUS_KEYS` versus design §3.2 (design §9.3)

**Confirmed.** The approved §3.2 step 2 says there is "no fixed maximum", and r2 refused more than 8. The approved requirement is **not** rewritten. The code was brought into line with it:

- `MAX_PREVIOUS_KEYS` is removed (`suppressionKeys.js`), together with the count check in `env.js`;
- `SUPPRESSION_HMAC_PREVIOUS_KEYS` is bounded only as an input: 32,767 characters, the Windows environment-variable limit. The rule text says so and never echoes the value.

The bound is recorded in design §9.3 for review. A new unit test shows 12 previous keys load, giving 13 lookup pairs, and an oversized value is refused with no key in the message.

### Finding 4 — the SUP-6 data-inventory entry (design §9.4)

**Confirmed.** r2 marked SUP-6 "partly open": no inventory document existed. **Added:** [`docs/privacy/DATA_INVENTORY.md`](../privacy/DATA_INVENTORY.md), the minimal entry for:

- `recipient_suppressions`;
- `recipient_suppression_keys`;
- the channel field `lastStatusCode`;
- the key material;
- logs and command output.

Each entry gives data subjects, purpose, fields, source, storage, access, retention, deletion, data-access lookup and backups (Doc 13 §§173, 177–178, 183–187, 190, 192, 197–198).

**Pending production inputs are marked AWAITING INPUT:**

- the MongoDB / hosting provider and region, contractual role and transfers;
- the production operator tokens;
- the protected key-copy location;
- the log destination;
- backup reconciliation;
- the Privacy Notice.

Retention stays **AWAITING PRIVACY / LEGAL / OPERATIONAL DETERMINATION** (Doc 13 §187). The rest of the Doc 13 §198 inventory (Applications, resumes, the email-backup entry AMD-OD-02) is outside B7 and is not entered.

**Drift test:** `tests/b7-suppression-inventory.test.js`, offline, now part of the B7 acceptance gate. It checks that:

- each model section names its collection and every stored field, read from the Mongoose schemas;
- `lastStatusCode` and its pattern are listed;
- every AWAITING marker is present;
- no address, digest or key-like value appears.

### Finding 5 — the history cap on the duplicate path (design §9.5)

**Confirmed.** In r2 the duplicate branch of `upsert` checked only "near the cap" (≥ 17), so at 20 it still saved `duplicateReports + 1`. r2 §5 item 4 ("At 20, every further action is refused") was therefore inaccurate for this path. r2 is kept as written and corrected here.

**Correction** (`upsert`):

- `refuseAtHistoryCap(active)` runs before any write and before the dry-run answer;
- near the cap, a duplicate still only increments `duplicateReports`;
- the re-apply branch now refuses at the cap in its dry run too, so the dry run reports what `--apply` would do.

**Audit of every register write path against the cap:**

| Path | At the cap (20 history entries) |
| --- | --- |
| `add` duplicate report | **Refused** (`HISTORY_CAP_REACHED`), dry run and `--apply` — *fixed* |
| `add` re-apply of a `LIFTED` entry | Refused with `--apply` (r2); **now also in the dry run** |
| `add` same source again | `ALREADY_ACTIVE`, no write (unchanged) |
| `lift`, `forget` (source removal), `resolve-unrecoverable` | Refused (unchanged) |
| `rekey` / `recover-key` move | Skipped and reported (`historyCap`), entry unchanged (unchanged) |
| `forget --reason PRIVACY_REQUEST` deleting the last source | Deletes; no history action (unchanged, Doc 13 §190) |
| Alias pruning (new) | Allowed: it records no action and changes no decision. Refusing it would keep the old key id in coverage permanently for that entry. **Flagged for confirmation (design §9.5).** |

**Tests — SUP-13b** (consistency file):

- near the cap, only `duplicateReports` changes (history and sources unchanged);
- at the cap, the dry run and `--apply` both refuse, and the document is byte-for-byte unchanged;
- a `LIFTED` entry at the cap is not re-applied (dry run and `--apply`);
- pruning at the cap leaves the history identical, while a `lift` at the cap is still refused.

## 4. Contract changes (r3 only)

- **Packages:** none. `package-lock.json` is unchanged.
- **Environment variables:** none added. `SUPPRESSION_HMAC_PREVIOUS_KEYS` now accepts any number of keys, at most 32,767 characters in all.
- **Database:**
  - `recipient_suppressions` gains `lookups` (1–8 items).
  - Index `suppression_coverage` is replaced by `suppression_coverage_lookups`, and `suppression_lookups_match` is added. The required set goes from 10 to 11.
  - **No migration.** No r2 register document exists outside disposable test databases, because B7 was never merged or deployed. The Windows run (§9) starts from an empty test database.
- **API:** no route, status or envelope changed.
- **Operator command:**
  - `--after <id>` for `rekey` and `recover-key`;
  - new output fields `examined`, `nextAfter`, `aliasesPruned`, `aliasesPrunable`, `lookupCap` and, in `coverage`, `aliasEntries`;
  - new refusals `INVALID_CURSOR` and `ALIASES_PENDING`.
- **Behaviour to note:** after a key move, a sender configured *without* the old key is blocked (`SUPPRESSION_COVERAGE_INCOMPLETE`) until the aliases are pruned, at least 10 minutes after the last move. It fails closed and never sends. Remove the old key from the configuration only when `coverage` shows `safeToRetire`.

## 5. Choices made in these corrections (for GPT review / owner confirmation)

1. **Equivalent synchronisation** (aliases with a quiet period) instead of a snapshot read, so that standalone servers keep working (§3, finding 1).
2. **`ALIAS_QUIET_PERIOD_MS` = 10 minutes**, against a read bound of at most 10 s. The two assumptions are in design §9.1.
3. **`MAX_LOOKUPS` = 8 per entry.** This bounds one document, not the configured keys. A move past it is skipped and reported.
4. **Alias pruning is not refused at the history cap** (finding 5 table).
5. **The previous-key variable is bounded at 32,767 characters**, an input bound and not a key-count maximum (finding 3).
6. **Pruning runs at the start of every `rekey`**, all keys, bounded by `--limit`, and in `recover-key --complete`, that key only. No separate subcommand was added.

## 6. Test execution

**Environment:** Linux sandbox; Node 24.21.0; MongoDB **8.0.23** (conda-forge build, SHA-256 `029796af…1df5a37`) as a disposable single-node replica set with `enableTestCommands=1`, plus one standalone server without test commands. The real SMTP adapter ran against the repository's local SMTP test server (TLS, test certificate, RCPT and message counter). Synthetic data and keys only. Nothing left the machine.

### 6.1 Final gate

**`npm run verify:b7`** ran on `44ab967dab663eeaf25444413609e2c3cc46cf8b` with a clean tree (`git status --porcelain` empty at start) and `MONGODB_TEST_URI` set to the replica set. Result: **`B7 VERIFICATION PASSED`, exit 0.**

| Gate | Result (r2 in brackets) |
| --- | --- |
| Node.js 24 | PASS |
| `verify:b6` | PASS. Exit 2: the live-provider gate is PENDING by design, and B6 was accepted on live evidence. |
| — offline suite B1–B7 | 62 files: **2,332 passed**, 1 skipped (Windows-only), 0 failed (r2: 61 files, 2,325) |
| — B6 / B5 / B4 acceptance gates | 460 / 236 / 584 passed (1 skipped), 0 failed (unchanged) |
| — engine check, index apply and check | MongoDB 8.0.23. **11 / 11** required indexes, including `suppression_coverage_lookups` and `suppression_lookups_match` (r2: 10 / 10). |
| — real-database suite B2–B7 | **19 files: 214 passed, 0 failed** (r2: 18 files, 188). It includes the new consistency file. |
| — B6 database gate; live-procedure rehearsal | 16 / 16; 17 / 17 (unchanged) |
| B7 acceptance gate (offline, 14 files) | **250 passed**, 1 skipped, 0 failed (r2: 13 files, 244). The inventory drift test was added. |
| Coverage diagnostic (offline) | lines 71.3 %, statements 69.79 %, functions 75.82 %, branches 69.03 %. No threshold. |
| `npm audit --omit=dev` | 0 vulnerabilities |

Offline coverage moved slightly because the new register and operation code is exercised only by the real-database suites. Measured under the four SUP database files on `44ab967`, suppression modules and model together: **lines 95.44 %, branches 76.83 %** (r2: 94.28 % / 75.61 %).

| Module | Lines | Branches |
| --- | --- | --- |
| `RecipientSuppression.js` | 98.4 % | 82.8 % |
| `suppressionGate.js` | 95 % | 77.8 % |
| `suppressionOperations.js` | 97.8 % | 80.5 % |
| `suppressionRegister.js` | 90.9 % | 62.2 % |
| `suppressionKeys.js` | 78.7 % (100 % offline) | 54.7 % |

### 6.2 Focused regressions and per-test runs

- **Before the commits** (uncommitted working tree whose code and tests equal `ca2c455`):
  - offline: units, inventory, indexes, acknowledgement gate, retry command, models and config — 7 files, **364 / 364**;
  - replica set: the four SUP database files plus `db/b6-notifications` — **83 / 83**.
- **Per-test run on `44ab967`** (JSON reporter):
  - replica set: **67 / 67**, no skips. Register 20, keys 19, cli 2, consistency 26; every fail-point case ran.
  - offline: **27 / 27**. Units 17, inventory 5, acknowledgement gate 5.
- **Standalone MongoDB 8.0.23 without test commands** (owner-like): the four SUP database files plus `db/b6-notifications` give **77 passed, 6 skipped**.
  - The six skips are the same fail-point cases as r2: SUP-11 ×3, SUP-14 killed write, SUP-19 and SUP-23c/d. Each reports `NOT RUN: mongod without enableTestCommands`.
  - All 26 consistency tests pass on standalone, so the alias mechanism needs no replica set. In SUP-25 the interruption step needs a fail point, so it is annotated NOT RUN and only the resumption from the cursor is exercised there.

### 6.3 Mutation checks (on `44ab967`; each control disabled in the working tree, tests run, file restored from Git, clean tree confirmed)

| # | Disabled control | Tests that failed | Behavioural evidence |
| --- | --- | --- | --- |
| M1 | A move **replaces** the old lookup (the r2 behaviour) | 20 of 26 in the consistency file | **The reported defect reproduced.** Old `{k1}` sender, coverage first, move between the reads: **RCPT for the suppressed address 1 → 2** (a submission). The same happens for the new `{k2}` sender, match first. |
| M2 | No quiet period (aliases pruned at once) | 7 | Move plus immediate prune between the reads: RCPT 1 → 2 for the old `{k1}` (coverage first) and the new `{k2}` (match first) senders |
| M3 | Coverage reads the **primary** key id only | 2 | New `{k2}` sender, match first, move between the reads: RCPT 1 → 2 |
| M4 | The pass ignores the `--after` cursor | SUP-25 ×2 | The resumed runs re-examine the blocked prefix and never reach the eligible entries |
| M5 | The duplicate path's cap check removed | SUP-13b | A duplicate at the cap is accepted instead of refused |
| M6 | A cap of 8 previous keys restored | units › previous keys | 12 previous keys refused (`ConfigurationError`) |
| — | A field removed from the inventory (checked during development) | inventory › §1.1 | `duplicateReports` reported missing |

After each mutation the file was restored from Git, and `git status --porcelain` showed only this untracked package.

### 6.4 Execution evidence (private; referenced by hash, not published)

These are the raw outputs of the runs above. They contain synthetic data only, and a scan found no address, key or credential. They are delivered with the bundle as `valida-b7-r3-evidence.tar.gz`, are not committed and are not for publication.

| File | SHA-256 |
| --- | --- |
| `verify-b7.log` (the §6.1 gate) | `62dbd36026d39ec39912a87d643173f6b1a92b83b23cdf1b8da36df275a2bde2` |
| `sup-db-rs.json` (per-test, replica set) | `765905d2572b271c5ecaf3186edde0227aec901215d836bfc537664dc6500f00` |
| `sup-offline.json` (per-test, offline) | `e90e36ade376d198f3c6edbfcf8da23e7ff7009296c68d8633417ee7ba8e9913` |
| `sup-db-standalone.json` (standalone parity) | `0b05ff00aafc5fe08d426f663c3e2ccfb2a994357b479bd847ace2b5e6322052` |
| `focused-offline.txt`, `focused-db.txt` (before the commits) | `583e3f064bffb3a6d9bc8784992d4e148f8b920b243d54821aa0a8a7dc0403a0`, `1ee651aee8909ed59dcc2e8cd04028629f163f2c3495323d7d3c53e4a940c6e5` |
| `mutations-final.txt`, `run-mutations.sh` (§6.3) | `2e8867daf918a91f3f98af576cea7badbe8bee3f68199c44fc793ea4856f6bda`, `67f1d1cb2757b8210e5c7b080af9e41d0a74a98275542a7c51c7e7d0b54b8877` |
| The archive itself | `6982f9cc2cb0f4e00ebe2245f3f55109461198fe230cfbef9f4ab46fc644e202` |

### 6.5 Manual and external verification

None: no live email, provider, DNS, deployment or production change. There are no screenshots, because there is no UI.

### 6.6 Known defects

None open. The two §9.1 assumptions are stated as assumptions, not defects.

## 7. Requirement → test mapping (r3 additions; the r2 mapping, r2 §7, still applies)

| Requirement | Test(s) | Result |
| --- | --- | --- |
| Finding 1 / **SUP-24**: no PROCEED for a suppressed address under any interleaving of a key move or prune with the two reads; 3 keyrings × 2 orders × 3 steps; zero submissions | `db/b7-suppression-consistency` › SUP-24 (18 cases, 2 controls, 1 alias case) | PASS (replica set and standalone); mutation-checked M1–M3 |
| Finding 1: add-versus-send boundary preserved | `db/b7-suppression-register` › SUP-12 (exact counts) | PASS |
| Finding 1: existing rotation, recovery and completion behaviour with aliases | `db/b7-suppression-keys` (19; completion after the quiet period, `ALIASES_PENDING` before it) | PASS (19 / 19) |
| Finding 2 / **SUP-25**: blocked prefix > limit; interruption; resumption; unresolved entries and history preserved; both commands | `db/b7-suppression-consistency` › SUP-25 (2) | PASS (interruption NOT RUN on standalone); mutation-checked M4 |
| Finding 3: no fixed maximum; input bound without echo | `b7-suppression-units` › B7 r3 previous keys | PASS; mutation-checked M6 |
| Finding 4 / SUP-6: inventory entry complete; AWAITING markers; no sensitive value | `b7-suppression-inventory` (5) | PASS (5 / 5) |
| Finding 5 / **SUP-13b**: cap on the duplicate and re-apply paths; pruning at the cap | `db/b7-suppression-consistency` › SUP-13b (3) | PASS; mutation-checked M5 |
| SUP-6 (r2: "partly open") | r2 SUP-6 test plus the inventory test | **PASS — no longer partly open.** The production inputs in the entry are AWAITING INPUT (C6). |
| G-SUP: production refusal unchanged | `b7-acknowledgement-gate` (5); units › production refusal | PASS |

## 8. Blockers and open items

| # | Item | Owner | Blocks |
| --- | --- | --- | --- |
| 1 | GPT review of these corrections, in particular the §5 choices and the two §9.1 assumptions; then the owner's confirmation of design rev 8.2 | GPT, then owner | Windows verification, B7 acceptance, push / merge |
| 2 | Windows + MongoDB verification against the final reviewed commit — **prepared only after this review is resolved** (§9) | Claude to prepare, then owner | Release B completion gate (§143) on the owner's platform |
| 3 | C6 prerequisites (unchanged): production key in the host secret store; **protected key-copy location (AWAITING INPUT)**; production operator tokens; and now the inventory's AWAITING production inputs (provider, region, role, transfers, log destination, backup reconciliation) | Owner, C6 | Any production acknowledgement |
| 4 | Retention period (Doc 13 §187) and the Privacy Notice description (AWAITING) | Privacy / legal / owner | Production retention automation; the Privacy Notice |
| 5 | Removing or relaxing the production refusal after G-SUP evidence is accepted | Separate owner decision | Production acknowledgements |
| 6 | Not run and not authorised: a live DSN end to end | — | — |

## 9. Windows / MongoDB verification — held

As instructed, the Windows verification will be prepared only **after this review is resolved**, against the final reviewed commit. **The r2 §9 procedure is superseded and must not be run.** Its expected counts (10 indexes; 41 SUP database tests) no longer apply, and the commit it names is not the final one.
