# B7 — review package r4: clock-free acknowledgement authorisation (design rev 8.3)

| | |
| --- | --- |
| Milestone | Release B — **B7 Backend Security, Failure & QA Gate** |
| Supersedes | [`B7_REVIEW_PACKAGE_R3.md`](B7_REVIEW_PACKAGE_R3.md) for the authorisation mechanism only. r1, r2 and r3 are kept **unchanged** as the record. The r3 fixes for findings 2–5 (bounded passes, no previous-key cap, the inventory entry, the history cap) are kept as they were. |
| Review input | GPT's r3 review: "the remaining security blocker is that acknowledgement authorization depends on operator clocks and on when a delayed write becomes visible". Checkpoint: `b7-work` `45e2bf29d1e98ec944b22df9f051b905b05bc8b6`. |
| Branch | `b7-work`, local only. It is not pushed, merged or deployed. |
| Status | **READY FOR GPT REVIEW.** The regression was demonstrated on r3, then fixed, and the final `verify:b7` passed on `81c1659` (§5). Design rev 8.3 is **PROPOSED** for GPT review and owner confirmation. The Windows / MongoDB verification is still held until review is resolved. Claude does not declare B7 accepted. Production candidate acknowledgements stay refused (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`), and there were no live sends. |

## 1. Commits (SSH-signed by the session key)

| # | Commit | Kind | What it contains |
| --- | --- | --- | --- |
| 14 | `494bddaefb64d47073a5a147776cfe8a52a76a9b` | code + test | The fix, the interleaving seam and every new or adjusted test |
| 15 | `4e6c84d107440a37bc1859eb80a733faf8f6dcf0` | docs + test | Inventory alias-retention wording; `pruneSeq`; the counter collection; drift checks |
| 16 | `81c16590041fdf03e40d4f689c0c2b58ef232dfe` | docs | Design rev 8.3 (§9.6), README, security matrix §8. **Every result in §5 was run on this commit.** |
| 17 | the bundle's HEAD | docs | This package |

**Diff `45e2bf2..81c1659`: 18 files, +672 / −158.** One file added (`backend/tests/db/fixtures/suppressionInterleave.js`); none deleted. The **focused diff** (production source plus the inventory: 6 files, +169 / −58) is delivered as `B7_R4_FOCUSED.diff`.

| File | + / − |
| --- | --- |
| `backend/src/modules/suppression/suppressionRegister.js` | +97 / −31 |
| `backend/src/models/RecipientSuppression.js` | +24 / −8 |
| `backend/src/modules/suppression/suppressionOperations.js` | +21 / −16 |
| `backend/src/modules/suppression/suppressionGate.js` | +9 / −0 |
| `backend/src/db/indexes.js` | +7 / −0 |
| `docs/privacy/DATA_INVENTORY.md` | +11 / −3 |
| `backend/tests/db/b7-suppression-consistency.test.js` | +255 / −66 |
| `backend/tests/db/fixtures/suppressionInterleave.js` (new) | +109 / −0 |
| `backend/tests/db/b7-suppression-keys.test.js` | +8 / −13 (the quiet-period waits removed) |
| `backend/tests/b7-suppression-units.test.js`, `b7-suppression-inventory.test.js`, `indexes.test.js` | +26, +15 / −1, +6 / −4 |
| `backend/tests/db/fixtures/suppression.js`, `suppressionHarness.js`, `tests/fixtures/suppressionDoubles.js` | the counter cleared between tests; the double reports `registerChanged: false` |
| `docs/architecture/RECIPIENT_SUPPRESSION_DESIGN.md`, `backend/README.md`, `docs/qa/b7/B7_SECURITY_TEST_MATRIX.md` | rev 8.3; README; matrix §8 |

## 2. The regression on r3 — demonstrated before any change

The test is SUP-24b in `tests/db/b7-suppression-consistency.test.js`. It ran against the **unchanged r3 code** (`45e2bf2`) on real MongoDB 8.0.23 (replica set), with synthetic data and the local SMTP counter, using exactly the requested ordering:

1. an old-key sender `{k1}` reads coverage;
2. operator A moves the `ACTIVE` suppression `k1 → k2`;
3. operator B attempts pruning at once;
4. the sender reads the match.

The order was enforced through the real register, and recorded by the seam as `coverage-ids`, `coverage-keys`, `between`, `match`.

| Case | r3 result |
| --- | --- |
| Operator B's clock **11 minutes ahead** | **The gate returned PROCEED.** The acknowledgement was recorded `SENT`, RCPT for the suppressed address went from 1 to 2, and the relay accepted 1 message. The entry was still `ACTIVE`, with lookups `['k2']`: B's prune removed the `k1` alias inside the read window. |
| Operator A's clock **11 minutes behind** (equivalent to its move becoming visible 11 minutes after it was stamped) | The same: `SENT`, RCPT 1 → 2, 1 message accepted |

Both cases failed on the zero-submission assertion: `expected 2 to be 1`. The raw outputs are `r3-regression.json` and `r3-observed.txt` (§5.4).

## 3. The fix (design §9.6)

**Why r3 failed.** r3 decided when an alias could be pruned by comparing a stamp written with one operator's clock against another operator's clock. The fix replaces that time test with a value that only ever increases:

- **Prune stamp.** Each alias prune sets the entry's `pruneSeq` to a fresh value, in the same conditional, durable write as the removal (`pruneAliases`).
  - The value comes from one counter document (`recipient_suppression_sequence`), allocated after the entry was read (`allocatePruneSeq`).
  - The counter is first raised above the highest stored stamp, so a lost or restored counter cannot hand out a value already in use.
  - A stored stamp never decreases; a validation hook enforces this.
  - Moves, adds, duplicate reports, lifts and `forget` do not stamp.
- **Send-path read** (`readForAcknowledgement`). Three ordered phases run inside the one time bound:
  1. read the highest stamp;
  2. read coverage and the match, issued together;
  3. read the highest stamp again.

  It returns `registerChanged`.
- **Gate.** It returns `PROCEED` only when the register confirms `registerChanged === false`. Otherwise the result is `FAILED` / `SUPPRESSION_CHECK_UNAVAILABLE`, which is TRANSIENT, logs reason `REGISTER_CHANGED`, and is re-checked by the normal retry. A match still suppresses, and incomplete coverage still blocks.
- **No quiet period.** `ALIAS_QUIET_PERIOD_MS` is removed. The next `rekey` run, or `recover-key --complete`, prunes aliases at once. `retiredAt` is kept for information only; no decision reads it.
- **Index.** `suppression_pruneSeq` `{ pruneSeq: -1 }` is added, for one index point read per stamp check. There are now 12 indexes.

**Why it holds without clocks.** The full argument is in design §9.6.

1. One key change between the two reads is harmless. A move adds a lookup, and a prune removes only an alias, so the two observed sets always share a key.
2. Missing a suppressed entry therefore takes a move followed by a prune of that entry.
3. The prune is conditional on a version that includes the move. Its operator therefore read the entry after the check began, and only then allocated its stamp.
4. That stamp is above everything the check saw in its first phase, and it is still visible in its last phase. So the two readings differ, and the gate does not `PROCEED`.

Nothing in this argument depends on wall clocks, write delays or how long the sender takes between reads. It needs no replica set.

**What is preserved:**
- standalone support (§5.2);
- SUP-12, the add-versus-send boundary: adds do not stamp, and SUP-12 passes with exact counts;
- the r3 fixes for findings 2–5;
- the production refusal.

**The cost.** An acknowledgement whose check overlaps an alias prune is deferred: TRANSIENT, with zero sends. The normal retry then sends it once (tested). Moves alone defer nothing.

## 4. Tests added or changed

- **Interleaving seam** (`tests/db/fixtures/suppressionInterleave.js`). The sender's register is the production `createSuppressionRegister`, given model wrappers through its existing `models` option.
  - The wrappers only delay when the real queries start, so the order is fixed and the step runs exactly between the reads.
  - Every query still runs against the database. The register's own stamp reads pass through unchanged.
  - The r3 SUP-24 helper rebuilt the two reads itself. All SUP-24 cases now go through the real `readForAcknowledgement` instead.
- **SUP-24b (3 cases):**
  - B's clock 11 minutes ahead;
  - A's clock 11 minutes behind;
  - A's move really held at the server by a fail point (`blockConnection`, 2.5 s) while the sender reads coverage, then B (clock +11 min) prunes at once.

  Each case asserts:
  - **zero RCPT and zero messages** for the suppressed address;
  - `FAILED` / `SUPPRESSION_CHECK_UNAVAILABLE`, with exactly one log reason, `REGISTER_CHANGED`;
  - the order coverage, step, match;
  - coverage saw `['k1']`, the match missed, and the entry ends `ACTIVE` with lookups `['k2']`.
- **SUP-24 (18 cases).** 3 keyrings × 2 orders × 3 steps. The "move and an immediate prune" case now really prunes. An `UNAVAILABLE` outcome must carry reason `REGISTER_CHANGED`, never a timeout or a failed read.
- **Positive control (2 cases).** With a move of another entry between the reads, the same real path acknowledges an unsuppressed address: `SENT`, 1 RCPT, 1 message.
- **Cost and recovery.** A prune between the reads defers an unsuppressed acknowledgement (zero sent). The normal retry, through the real unsteered register, sends it once (`attemptCount` 2).
- **Stamp and counter cases:**
  - alias retention, with no clock deciding anything (operators at −11 min and +11 min);
  - stamps are distinct and increasing, and the counter value is checked;
  - a lost counter document never repeats a value in use;
  - the stamp is monotonic (validation refuses a decrease);
  - `ALIASES_PENDING` beyond `--limit`, then completion.
- **Gate units (3).** PROCEED only with `registerChanged === false`; `true`, `undefined`, `null` or anything else gives `REGISTER_CHANGED`; a match still suppresses and incomplete coverage still blocks.
- **Inventory drift (2).** §1.2a names the counter; §1.1 describes no time limit or quiet period and says `retiredAt` is informational.
- **Adjusted:** the key tests no longer wait for a quiet period (completion prunes at once and stamps); the index tests expect 12.

## 5. Evidence

### 5.1 Final gate

`npm run verify:b7` ran on `81c16590041fdf03e40d4f689c0c2b58ef232dfe`, with a clean tree (`git status --porcelain` empty at start) and the replica set as the database. Result: **`B7 VERIFICATION PASSED`, exit 0.**

| Gate | Result (r3 in brackets) |
| --- | --- |
| Node.js 24 | PASS (v24.21.0) |
| `verify:b6` | PASS. Exit 2: the live-provider gate is PENDING by design. |
| — offline suite | 62 files: **2,338 passed**, 1 skipped, 0 failed (2,332) |
| — B6 / B5 / B4 gates | 460 / 236 / 584 passed (1 skipped), unchanged |
| — index apply and check | **12 / 12** (11 / 11) |
| — real-database suite B2–B7 | 19 files: **221 passed**, 0 failed (214) |
| — B6 database gate; rehearsal | 16 / 16; 17 / 17 |
| B7 acceptance gate | **255 passed**, 1 skipped (250) |
| Coverage diagnostic | lines 71.04 %, branches 68.67 % — no threshold |
| `npm audit --omit=dev` | 0 vulnerabilities |

### 5.2 Per-test runs on `81c1659`

- **Replica set:** **74 / 74**, no skips. Register 20 (including **SUP-12**), keys 19, cli 2, consistency 33.
- **Offline:** **32 / 32**. Units 20, inventory 7, acknowledgement gate 5 (G-SUP production refusal).
- **Standalone MongoDB 8.0.23, no test commands:**
  - The four SUP files plus `db/b6-notifications` give **83 passed, 7 skipped**.
  - The skips are the six fail-point cases of r3, plus the new held-write SUP-24b case. Each reports `NOT RUN: mongod without enableTestCommands`.
  - **All other SUP-24 and SUP-24b cases pass on standalone**, including both clock-skew cases.

### 5.3 Mutation checks (on `4e6c84d`)

`4e6c84d` has the same code as `81c1659`. Each control was disabled in the working tree, the tests were run, and the file was restored from Git; the tree was then clean. In the results below, "RCPT 1 → 2" means the suppressed address received a submission (one more RCPT at the local relay than before the attempt).

| # | Disabled control | Failed | Result |
| --- | --- | --- | --- |
| N1 | The gate ignores `registerChanged` | 6 | **RCPT 1 → 2** in 5 cases: SUP-24b ×3, and the immediate-prune case for the old `{k1}` sender (coverage first) and the new `{k2}` sender (match first). The cost case was `SENT` instead of deferred. |
| N2 | A prune is not stamped | 10 | **RCPT 1 → 2** in the same 5 cases. The stamp, counter and completion cases also fail. |
| N3 | The stamp is read only once (`after = before`) | 6 | **RCPT 1 → 2** in the same 5 cases. The cost case also fails. |
| N4 | The counter is not raised above stored stamps | 1 | The counter-loss case: a stamp value is repeated |
| N5 | The monotonic-stamp guard is removed | 1 | The monotonic case: a decrease is accepted |
| M1 | A move **replaces** the lookup (no alias) | 27 | **RCPT 1 → 2.** The old-key sender, coverage first, move only. |
| M3 | Coverage reads the primary key id only | 1 | **RCPT 1 → 2.** The new-key sender, match first. |

### 5.4 Execution evidence (private; referenced by hash)

These files are delivered as `valida-b7-r4-evidence.tar.gz`. They are not committed and not for publication. They hold synthetic data only, and a scan found no address, key or credential.

| File | SHA-256 |
| --- | --- |
| `r3-regression.json`, `r3-regression.txt` (§2, on `45e2bf2`) | `f470468f297bfa697860eeb05e1f06a360988cb0cc106798d3cd863b8aefb5c7`, `e292b1b0a0d2b2bfbdeb72b4ae079de29aac1c1508955f1c416ac4bbc25bdfd1` |
| `r3-observed.txt` (what r3 recorded in each case) | `c02e5f3a8298b39697a6dca281383b74204598103d0d91f978d6617f99682a06` |
| `verify-b7.log` (§5.1) | `96ff9102261b166147d3a2944d494ad8132fe41c00539d8554aaac102260ecdd` |
| `sup-db-rs.json`, `sup-offline.json`, `sup-db-standalone.json` (§5.2) | `19ecddabe9bd4250c0d14f701137093b91d1e0a3594d18d1c38777108406ba2f`, `0768e3fe5250e8729c832f5a326b8c2505e437181d813065beb6ff32184afa0f`, `6ed9d72e751ee0a4c969158701aa817edda2554ff00ebe748d8f04568c924c03` |
| `focused-db-dev.json` (before the commit: the four SUP files plus `db/b6-notifications`, 89 / 89) | `c777aa7c9dff6e2210ecd6f4385d9f9ce13faa4fcded5122bbb9d8cf98e5c287` |
| `mutations-final.txt`, `run-mutations.sh` (§5.3) | `f06cd2c49bcc4f0b155defa97d67f79d5c17f8ae51d1a2bbfe925dca0a0dd237`, `4945a1e76a2a3b0612e4eabc4b7a3e0475bb663921bef58fa3babbf7364cc57e` |
| The archive itself | `d935812f9c4d7762332f5bdca23a6e2a29e4fe59974c167f503d04a25e68d0f2` |

## 6. Contract changes (r4 only)

- **Packages and environment variables:** none.
- **Database:**
  - `recipient_suppressions.pruneSeq` (integer, default 0, never decreases);
  - new collection `recipient_suppression_sequence`, one counter document with no personal data;
  - index `suppression_pruneSeq`, for 12 required indexes in all.
  - **No migration.** Documents without the field read as 0, and B7 was never deployed.
- **API:** no route, status or envelope changed.
- **Stored outcome:** a new log reason, `REGISTER_CHANGED`, under the existing TRANSIENT code `SUPPRESSION_CHECK_UNAVAILABLE`.
- **Operator command:**
  - `rekey` and `recover-key --complete` no longer wait 10 minutes before pruning;
  - `ALIASES_PENDING` now means aliases beyond `--limit` or in a write conflict.

## 7. For confirmation

1. **Design rev 8.3 replaces the rev 8.2 quiet period.** The withdrawn text is kept in §9.1 and marked as superseded.
2. **The cost.** An acknowledgement whose check overlaps an alias prune is deferred, TRANSIENT; prunes are operator runs during a rotation.
3. **The new counter collection**, and its inventory entry (§1.2a).
4. **The residual edge noted in §9.6:** if an entry is deleted by `forget` inside the window, the address was intentionally re-enabled, as with a lift (§3.5).

## 8. Open items (unchanged except where noted)

- GPT review of r4, then the owner's confirmation of design rev 8.3.
- The Windows / MongoDB verification, to be prepared only after this review is resolved. The r2 §9 procedure stays superseded.
- C6 prerequisites: the production key, the protected key-copy location (**AWAITING INPUT**), operator tokens, and the inventory's AWAITING production inputs.
- Retention (Doc 13 §187) and the Privacy Notice: **AWAITING**.
- Removing the production refusal requires a separate owner decision.
