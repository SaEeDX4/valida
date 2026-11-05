# B7 — review package r5: suppression authorisation reads only the primary (design rev 8.4)

| | |
| --- | --- |
| Milestone | Release B — **B7 Backend Security, Failure & QA Gate** |
| Supersedes | [`B7_REVIEW_PACKAGE_R4.md`](B7_REVIEW_PACKAGE_R4.md) for read routing only. r1–r4 are kept unchanged as the record. The r4 prune-sequence design is kept exactly as it was. |
| Review input | GPT's r4 review: enforce the approved primary-read requirement in suppression authorisation, because the accepted URI setting `readPreference=secondaryPreferred` reaches these queries. Checkpoint: `b7-work` `bbbd63812edf76197ca98a162e989aaa8401b234`. |
| Branch | `b7-work`, local only. Not pushed, merged or deployed. |
| Status | **READY FOR GPT REVIEW.** The regression was shown on r4 first, then fixed. The final `verify:b7` passed on `0403a8d` (§4). Claude does not declare B7 accepted. Production candidate acknowledgements stay refused (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`), and there were no live sends. The Windows / MongoDB verification stays held until review is resolved. |

## 1. Commits (SSH-signed by the session key)

| # | Commit | Kind | What it contains |
| --- | --- | --- | --- |
| 18 | `14969e40c5d61b24395e064be04ab450520875a0` | code + test | The fix: primary on every suppression read. Also the RP-1…RP-5 regression and the offline guards. |
| 19 | `0403a8d4d845810e7bf22862d2cf53de195b59fb` | docs | Design rev 8.4 (§9.7), README, security matrix §9. **Every §4 result was run on this commit's code.** |
| 20 | the bundle's HEAD | docs | This package |

**Diff `bbbd638..0403a8d`: 7 files, +537 / −16.** One file added: `backend/tests/db/b7-suppression-read-preference.test.js`. None deleted.

The **focused diff** covers production source only: `suppressionRegister.js` +23 / −13 and `suppressionOperations.js` +3 / −1. It is delivered as `B7_R5_FOCUSED.diff`.

The other changes are:
- `tests/b7-suppression-units.test.js` (+72 / −1): two offline guards, and the SUP-9 stub now also checks the primary read;
- the new RP test file (+384);
- design (+33 / −1), README (+10) and matrix (+12).

There are no data, index, configuration-variable, API or package changes. The only new variable is `MONGODB_TEST_DISPOSABLE_TOPOLOGY`, which is used by tests only.

## 2. The regression on r4 — shown before any change

**Test:** `tests/db/b7-suppression-read-preference.test.js`.
- It binds the **real** register to a connection opened with the accepted URI setting `readPreference=secondaryPreferred`, the same way production models inherit their connection's preference.
- The app's own reads use the ordinary test connection, so only the suppression queries are under test.
- Command monitoring records every command the register sends: its name, collection, read preference and the server it went to.
- Data and keys are synthetic, and the SMTP server is the local one with its submission counter.

**On the unchanged r4 code (`bbbd638`):**

| Topology | What r4 did |
| --- | --- |
| Single-node replica set (`rs0`) | All five send-path reads carried `readPreference=secondaryPreferred`: stamp, coverage key ids, match, key documents, stamp. So did all 15 operator reads in RP-3, including the Application read, `listIndexes` and the allocation's stamp read. With no secondary present, they still reached the only server. |
| Three-node replica set (`rs1`: primary `:27031`, hidden member, readable priority-0 secondary `:27033`) | Every one of those reads went to the **secondary** `127.0.0.1:27033`. |
| `rs1`, replication paused on the secondary (RP-5) | **An already-suppressed recipient was acknowledged**: RCPT 1 → 2. The secondary held zero suppression entries, so the match missed and the gate allowed the send. |
| `rs1`, no primary (RP-4) | The connection that was open when the primary left failed closed, because Mongoose marks it disconnected. A connection opened **after** the primary left reported connected, and r4 **decided `SUPPRESSED` from the secondary** instead of failing closed. |

Results: RP-1…3 failed on both replica sets. RP-4 and RP-5 failed on `rs1`. The raw outputs are `r4-rs0.*` and `r4-rs1.*` (§4.5).

## 3. The fix (design §9.7)

**Register.** Every register read sets readPreference `primary` explicitly, through `SUPPRESSION_READ_PREFERENCE`. This covers:
- `highestPruneSeq`: both send-path stamps and the allocation's highest-stamp read;
- the coverage `distinct` and the key documents;
- the recipient match;
- the operator reads: entries, entry, count, per-key aggregate, key documents and `listIndexes`.

**Operator command.** It reads stored Applications from the primary too: the source, check, add and forget reads, and the bounce correlation.

**Writes** already went to the primary.

**Without a reachable primary:**
- every read fails, so the send path is `FAILED` / `SUPPRESSION_CHECK_UNAVAILABLE` (TRANSIENT);
- the operator command fails without writing;
- no secondary is ever asked.

**Unchanged:**
- Standalone servers: there is one server, and the driver sends no read preference to it.
- The r4 sequence design, SUP-12, and the existing positive controls.

## 4. Evidence

### 4.1 The regression on the fix

| Case | `rs0` | `rs1` (3 nodes) | Standalone |
| --- | --- | --- | --- |
| RP-1 already-suppressed recipient | PASS — **0 submissions**; 5 reads, all `primary` on `:27017` | PASS — **0 submissions**; 5 reads, all on the primary `:27031` | PASS — 0 submissions |
| RP-2 positive control | PASS — SENT once; reads `primary` | PASS — SENT once; reads on `:27031` | PASS |
| RP-3 operator path | PASS — every read `primary` | PASS — every read on `:27031` | PASS |
| RP-4 no primary | NOT RUN (single node) | PASS — see below | NOT RUN |
| RP-5 stale secondary | NOT RUN | PASS — see below | NOT RUN |

**RP-4 (no primary).**
- The connection that was open when the primary left reports readyState 0, and the check returns `UNAVAILABLE` / `READ_FAILED`.
- A connection opened afterwards reports readyState 1. With it, the check returns `UNAVAILABLE` / `TIMEOUT`: server selection waited for a primary.
- In both cases, for the suppressed and the unsuppressed address, **zero** suppression commands were started, no prune sequence was allocated, and coverage reads were refused.

**RP-5 (stale secondary).** The paused secondary held 0 suppression entries. The check still returned **0 submissions** (`RECIPIENT_SUPPRESSED`), with all five reads on the primary.

**About the standalone results.** On standalone, "readPreference=primary" in the evidence means the driver sent no read preference. A standalone server cannot route anywhere else, which is why r4 behaves the same there.

### 4.2 Final gate

`npm run verify:b7` on `0403a8d4d845810e7bf22862d2cf53de195b59fb`, clean tree, database `rs0`: **`B7 VERIFICATION PASSED`, exit 0.**

| Gate | Result (r4 in brackets) |
| --- | --- |
| Node.js 24 | PASS (v24.21.0) |
| `verify:b6` | PASS. Exit 2: the live-provider gate is PENDING by design. |
| — offline suite | 62 files: **2,340 passed**, 1 skipped (2,338) |
| — B6 / B5 / B4 gates | 460 / 236 / 584 (1 skipped), unchanged |
| — index apply and check | 12 / 12 |
| — real-database suite B2–B7 | 20 files: **225 passed**, 2 skipped (RP-4 and RP-5 NOT RUN on a single node), 0 failed (19 files, 221) |
| — B6 database gate; rehearsal | 16 / 16; 17 / 17 |
| B7 acceptance gate | **257 passed**, 1 skipped (255) |
| Coverage diagnostic | lines 71.63 %, branches 69.05 %. No threshold. |
| `npm audit --omit=dev` | 0 vulnerabilities |

### 4.3 Per-test and topology runs (on `0403a8d`)

- **`rs0`, the five suppression database files:** 78 passed, 2 skipped (RP-4, RP-5). Register 20 (including **SUP-12**), keys 19, cli 2, consistency 33 (including the SUP-24 **positive controls**), read preference 4.
- **`rs1` (three nodes), the four existing suppression files plus `db/b6-notifications`:** **90 / 90**. **`rs1`, the read-preference file:** **6 / 6**.
- **Standalone without test commands:** 87 passed, 9 skipped. These are the 7 fail-point cases of r4 plus RP-4 and RP-5, each reporting NOT RUN.
- **Offline:** 34 / 34. Units 22, inventory 7, acknowledgement gate 5 (the G-SUP production refusal).

### 4.4 Mutation checks (on `14969e4`, against `rs1` and offline)

Each primary read was removed in turn, the tests were run, and the file was restored from Git. The tree was clean afterwards.

| # | Removed | `rs1` RP file | Offline guard | Behavioural effect |
| --- | --- | --- | --- | --- |
| P1 | primary on the stamp read | 5 fail | fails | Stamp reads go to the secondary |
| P2 | primary on the match | 3 fail | fails | **RP-5: 1 submission** to the suppressed recipient |
| P3 | primary on the coverage key ids | 5 fail | fails | Reads go to the secondary |
| P4 | primary on the key documents | 5 fail | fails | Reads go to the secondary |
| P5 | primary on the operator's Application read | 1 fail (RP-3) | fails | — |
| P6 | the module preference set to `secondaryPreferred` | 5 fail | fails | **RP-5: 1 submission** |

### 4.5 Execution evidence (private; referenced by hash)

Delivered as `valida-b7-r5-evidence.tar.gz`. Not committed and not for publication. Synthetic data only; a scan found no address, digest, key or credential. The commands are recorded by name, collection, read preference and server, never by filter.

| File | SHA-256 |
| --- | --- |
| `r4-rs0.json` / `.txt` (§2, `bbbd638`) | `96cd099ae6746db7dfb8f98270600f822209a94dacedfcdcf6331efae877fd6a` / `443e37b706ddf320fdc24fcef84723819fdffc729080ff7a6de2699b64f85473` |
| `r4-rs1.json` / `.txt` (§2) | `55da23e30134604d6176bcdf3ce39cb9f8909a99ac9c53268d236d9584e4e90c` / `ed6d0f4e338ed011bc986a115e961d705d389d9c0733c0b80f341946fa9d1496` |
| `fix-rs0.json` / `.txt` (§4.1) | `29a8997fc0e52a46f01b341bfd332f01b242d99a0a688e6a56b50c432bb90990` / `c29597302a82ab71db5c5055f06b4ae8844107749330a0a720f2a47737259a6c` |
| `fix-rs1.json` / `.txt` (§4.1) | `cb0db4a70b5efba3cc29eaf7a13d737236992c0b6cbb8584f4cc16562f7f9442` / `799ab4af2531798d36ed45663f95baea84fc1f3e7275c5162c9452a546c32677` |
| `fix-standalone.json` / `.txt` (§4.1) | `bdd0f4ee8f7faa21291f7b38d44ede18d50b30f3ccf01c7166356a875f3b5e18` / `ce3dfe4dd0e4e87122777ea0c50ead5ece45c5e5589a2ea01b154c8b948c034d` |
| `verify-b7.log` (§4.2) | `1f7e6dcecdcf101d759ad64961513b59d12c0d4a3f924f44de133a891b2f5e5c` |
| `sup-db-rs0.json` (§4.3) | `e758f48b98cca53f4dc4419cb73472411ebc62df653623fca805e03c816553af` |
| `sup-db-rs1.json` (§4.3) | `b10f66bccd53fa9a7571521fbc35164fbb5ec8e43c38cfcb3891922be850c554` |
| `sup-db-standalone.json` (§4.3) | `db7e4f646f66dd92b05c17ec9748241c1499c2b195c2ad42ce06aba02d346784` |
| `sup-offline.json` (§4.3) | `ce69f89646f330932929e59c8c50e4e048f1d151ee2c3a171d3cd5c2938a9e16` |
| `rp-rs1-final.json` / `.txt` (§4.3) | `6d8e90ca7d1d4fd7e9322f42bc7a09da887dcc1c53a2421b1c05e7693bfbe77d` / `976d65f3168ca14e8c71b3c5c28f893fcb99c5fb2b03694c6336ff92cabd42cf` |
| `focused-db-dev.json` (before the commit: the six suppression and B6 database files on `rs0`, 94 passed, 2 NOT RUN) | `803a43fb880dfa1f17359052cee357e4c66cae417c888493bedc6a33f7fb6a61` |
| `mutations-final.txt`, `run-mutations.sh` (§4.4) | `088ee518f4ee8e1658aff5a1240748aa6fa96d4323c205b9325f4375535f2291`, `fce7f917801959dba82a7cc0cb012431a74a53908246cd3dfb6b8338b13c9878` |
| The archive itself | `52b21b8735b488a65cbe6ce573d75ad5f1d731795cc3a50f26d7b78640452600` |

## 5. For confirmation

1. **Operator command.** Primary reads apply to the operator command's reads as well as the send path. The register header has always said "send path and operator command".
2. **Not covered — deposed primary.** During a network partition, a primary that has not yet stepped down can still answer reads with read concern `local`. This is a property of primary reads, not of this change. `linearizable` reads would close it at a latency cost. They are not implemented and are listed as an option.
3. **Not covered — other repositories.** Other repositories also inherit a URI read preference: on the Apply path, the Application load and the idempotency lookup. Their reads are outside suppression authorisation and were left unchanged. Should configuration refuse a non-primary `readPreference` in `MONGODB_URI` altogether? That decision is left to GPT and the owner.
4. **The opt-in variable.** `MONGODB_TEST_DISPOSABLE_TOPOLOGY=1` lets RP-4 and RP-5 step a replica set's primary down and pause a secondary. It is meant only for a set created for the test.

## 6. Open items (unchanged)

- GPT review of r5, then the owner's confirmation of design rev 8.3 and rev 8.4.
- The Windows / MongoDB verification, prepared only after review is resolved.
- C6 prerequisites: the production key; the key-copy location (**AWAITING INPUT**); operator tokens; the inventory's AWAITING production inputs.
- Retention (Doc 13 §187) and the Privacy Notice: **AWAITING**.
- Removing the production refusal needs a separate owner decision.
