# B7 — review package r6: a stale former primary cannot authorise an acknowledgement (design rev 8.5)

| | |
| --- | --- |
| Milestone | Release B — **B7 Backend Security, Failure & QA Gate** |
| Supersedes | [`B7_REVIEW_PACKAGE_R5.md`](B7_REVIEW_PACKAGE_R5.md) for the send path's read concern only. r1–r5 are kept unchanged as the record, and their fixes are kept: the r4 prune sequence and the r5 primary reads. |
| Review input | The owner authorised one focused investigation under SUP-12 and design §3.5 (2026-11-05). Checkpoint: `b7-work` `921c2997807a9bae6875662551fb32e11bec497f`. |
| Question | After the current MongoDB primary majority-acknowledges a suppression, can an acknowledgement whose suppression lookup starts afterwards reach SMTP through a former primary that still considers itself writable? |
| Verdict | **Yes on `921c299`: a real defect.** The suppressed recipient reached SMTP (RCPT TO 1 → 2). It is **corrected** in the acknowledgement authorisation path. On the corrected commit the same regression gives zero submissions: the check fails closed before SMTP, and the deferred acknowledgement ends `RECIPIENT_SUPPRESSED` after the heal. |
| Branch | `b7-work`, local only. Not pushed, merged or deployed. |
| Status | **READY FOR GPT REVIEW.** The regression was shown on `921c299` first, then fixed. The final `verify:b7` passed on `28e8a6c` (§5.2). Claude does not declare B7 accepted. Production candidate acknowledgements stay refused (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`), and there were no live sends. The Windows verification stays held for the final, independently reviewed version. |

## 1. Commits (SSH-signed by the session key)

| # | Commit | Kind | What it contains |
| --- | --- | --- | --- |
| 21 | `58fd15e51376599d158a1d028a0b1cd023f8d2e5` | code + test | The fix: the send-path reads are `linearizable` on a replica set. Also the stale-primary regression SP-1…SP-3, the partition bridge and the offline guards. |
| 22 | `d8a73385a0c850386fea488f7859840df45d49a0` | test | SP-1 also retries the deferred acknowledgement after the heal. |
| 23 | `28e8a6cb6a17bbb828fc825717c1d6df3e7b1bc8` | docs | Design rev 8.5 (§9.8), README, security matrix §10. **The final `verify:b7` ran on this commit** (§5.2). Its runtime code is identical to `58fd15e`'s. |
| 24 | the bundle's HEAD | docs | This package |

**Diff `921c299..28e8a6c`: 7 files, +802 / −25.** Files added:
- `backend/tests/db/b7-suppression-stale-primary.test.js` (+462);
- `backend/tests/db/fixtures/partitionBridge.js` (+159).

None deleted.

The **focused diff** covers production source only: `backend/src/modules/suppression/suppressionRegister.js` **+49 / −18**. It is delivered as `B7_R6_FOCUSED.diff` and reproduced in §4.

The other changes are:
- `tests/b7-suppression-units.test.js` (+34 / −4): the offline guards;
- design (+59 / −3), README (+25), matrix (+14).

There are no data, index, configuration-variable, API, package or read-preference changes. The only new variable is `MONGODB_TEST_PARTITION_NODES`, and it is used by tests only.

## 2. The path traced (before any edit)

| Step | Code | Write / read |
| --- | --- | --- |
| Apply → bounded follow-up | `application.submission.js` awaits `notifier.notifyAccepted` inside the request | — |
| 1. Claim | `applications.claimNotificationAttempts` → conditional save | `w: majority, j: true`, `wtimeout` |
| 2. Gate (acknowledgement channel only) | `suppression.checkAcknowledgement` → `register.readForAcknowledgement` | Five reads, all with readPreference `primary`: highest prune stamp; coverage key ids ∥ key documents ∥ recipient match; highest prune stamp. On `921c299` their read concern was **`local`**. |
| 3. SMTP | `notifications.deliver` | only on `PROCEED` |
| 4. Outcome | `recordNotificationOutcomes` | `w: majority, j: true` |
| Retry | `runNotificationRetry` → `notifier.retry` → the **same** attempt (steps 1–4). `scripts/notifications-retry.mjs` builds the same gate. | — |

Nothing between the claim and SMTP needed a majority. A claim that was majority-committed before a partition therefore could not protect the send.

## 3. The regression on `921c299` — shown before any change

**Test:** `tests/db/b7-suppression-stale-primary.test.js`, using the TCP bridge `tests/db/fixtures/partitionBridge.js`.

**Topology:**
- A disposable replica set `rs2` with members A, B and C (priorities 3/2/1, `electionTimeoutMillis` 10 000). It runs on MongoDB 8.0.23 with test commands, on fresh data directories.
- Each member sits behind a bridge, and the set's configuration names the bridge addresses. Each connection is identified from its handshake: another `mongod` by its `hostInfo`, a driver by its `appName`. It is then forwarded, black-holed (bytes dropped, socket kept open — what a real partition looks like) or refused.
- Every member's own view is read **directly**, not through the bridge, using `hello.isWritablePrimary`, the member state and the term.

**Ordering, per the brief:**
1. **Step 1:** A–B is black-holed. The sender (`appName=qa-sender`) can now reach only A, and the majority-side operator (`qa-majority`) cannot reach A.
2. **Step 2, eight seconds later:** A–C is black-holed. B is elected about ten seconds after step 1, while A still counts C as reachable. That gives a window of several seconds in which both report `isWritablePrimary: true`.
3. **SP-1:**
   - The acknowledgement is **claimed on the healthy set before the partition**: it is replicated to all three members (`w: 3` marker), and the lookup is held.
   - The stale-primary window is opened.
   - The real operator command adds the suppression on B (`w: majority, j: true`).
   - The entries are counted on each member, and only then is the lookup released.
4. **SP-2:** the retry path, with its claim attempted **during** the partition.
5. **SP-3:** the healthy, unsuppressed positive control.

The app, notifier, gate, register and SMTP adapter are all real. SMTP is the local counting server. Keys, recipients and data are synthetic. Every command is recorded with its actor, command, collection, serving member, read concern sent, outcome and duration.

**SP-1 on `921c299` (decisive):**

| t (ms) | Event | Served by |
| --- | --- | --- |
| 440 | The claim (update `applications`) | A (healthy set) |
| 465 / 8 466 | Partition steps 1 and 2 | — |
| 16 467 | **Window open: A `PRIMARY`, term 3, writable; B `PRIMARY`, term 4, writable**; C `SECONDARY`, term 4 | read on each member |
| 16 496 → 16 502 | The suppression is inserted and **majority-acknowledged** | **B** |
| 16 509 | Suppression entries per member: **A 0, B 1, C 1**. A is still writable. | read on each member |
| 16 510 | **The lookup starts** (8 ms after the acknowledgement) | — |
| 16 511 – 16 518 | All five send-path reads, read concern `local`, succeeded | **A** |
| 16 519 | **Gate decision `PROCEED`** | — |
| 16 716 | A is still `PRIMARY`, term 3, writable | read on A |
| 16 638 | The outcome write returned after 1 634 ms | A |
| 21 639 | Apply response `201` | — |

**The suppressed recipient's RCPT TO count went 1 → 2.** SP-1 failed: `expected 2 to be 1`.

SP-2 passed on `921c299`. The claim attempted on A inside the window could not be majority-acknowledged, so the result was `CLAIM_FAILED` 1, with no lookup and RCPT unchanged. SP-3 passed: sent once.

The failing evidence is preserved: `head/` in the archive (§5.5).

## 4. The fix (design §9.8)

**Change.** On a replica set, the five send-path reads in `readForAcknowledgement` use read concern **`linearizable`**:
- each read keeps readPreference `primary` (r5);
- each read keeps `maxTimeMS` equal to the time left in the check (`SUPPRESSION_LOOKUP_TIMEOUT_MS`, default 2 000 ms).

**Why it closes the gap.** A former primary cannot get a majority to confirm a linearizable read, so the read fails within the bound. The gate returns `SUPPRESSION_CHECK_UNAVAILABLE` (TRANSIENT) **before any SMTP**, and the acknowledgement is deferred and retried later with a fresh check. When freshness cannot be established — a timeout, an error, or an unknown topology — the check fails closed.

**Standalone.** A standalone server keeps the server default (`local`). It rejects `linearizable` (it is not a replica set) and has no other member that could hold a newer write. The rule is `sendPathReadConcern(model)`: read concern `local` only when the driver's topology is `Single` and every server is `Standalone`; `linearizable` otherwise, including an unknown topology.

**Unchanged:**
- operator reads, every write, the allocation's stamp read and every other repository;
- the read preference and read concern of the application as a whole;
- the r4 prune stamps and the r5 primary reads;
- SUP-12's add-versus-send boundary;
- the bounded timeouts.

```diff
@@ suppressionRegister.js
+export const SEND_PATH_READ_CONCERN = 'linearizable';
+export function sendPathReadConcern(model) {
+  const description = model?.db?.getClient?.()?.topology?.description;
+  const servers = description?.servers instanceof Map ? [...description.servers.values()] : [];
+  const standalone = description?.type === 'Single' && servers.length > 0 && servers.every((server) => server.type === 'Standalone');
+  return standalone ? null : SEND_PATH_READ_CONCERN;
+}
+const withReadConcern = (query, level) => (level ? query.readConcern(level) : query);
   …each of highestPruneSeq / readCoverageInputs / findActiveMatch takes an optional readConcern…
   async readForAcknowledgement({ pairs }) {
-      const before = await highestPruneSeq(left());
-      const [coverage, match] = await Promise.all([readCoverageInputs(left()), findActiveMatch(pairs, left())]);
-      const after = await highestPruneSeq(left());
-      return { ...coverage, match, pruneSeq: { before, after }, registerChanged: before !== after };
+      const readConcern = sendPathReadConcern(Suppression);
+      const before = await highestPruneSeq(left(), readConcern);
+      const [coverage, match] = await Promise.all([readCoverageInputs(left(), readConcern), findActiveMatch(pairs, left(), readConcern)]);
+      const after = await highestPruneSeq(left(), readConcern);
+      return { ...coverage, match, pruneSeq: { before, after }, registerChanged: before !== after, readConcern: readConcern ?? 'local' };
```

## 5. Evidence

### 5.1 The same regression on the corrected code

These runs are on `d8a7338`, which has the same runtime code as `28e8a6c`. Each run started with fresh `rs2` data.

| Run | SP-1 (claim before the partition) | After the heal | SP-2 (retry) | SP-3 (control) |
| --- | --- | --- | --- | --- |
| final | **RCPT 1 → 1.** `UNAVAILABLE` / `SUPPRESSION_CHECK_UNAVAILABLE` (`TIMEOUT`). The lookup started 9–13 ms after the add was majority-acknowledged; the entries were A 0, B 1, C 1. Its reads went to **A** with read concern `linearizable`, and the first failed after 3 002–3 006 ms (`MaxTimeMSExpired`; the test's sender bound is 3 000 ms). At the decision, A was `PRIMARY`, term 1, writable; B was `PRIMARY`, term 2, writable. | Majority holds `FAILED` / `SUPPRESSION_CHECK_UNAVAILABLE`. The retry gate decides **`SUPPRESSED`** (`RECIPIENT_SUPPRESSED`); RCPT 1 | `CLAIM_FAILED` 1; RCPT 2 → 2 | `PROCEED`; RCPT 1, 1 message; `linearizable` on A |
| repeat 2 | same | same | same | same |
| repeat 3 | same | same | same | same |
| **mutation M1** (read concern forced back to `local`, as on `921c299`) | **RCPT 1 → 2**, `PROCEED`, reads to A with no read concern | — (already sent) | `CLAIM_FAILED` | sends; fails only its read-concern assertion |

- **The reason code varies.** The reason is `TIMEOUT` or `READ_FAILED`, depending on whether the client-side bound or the server's `maxTimeMS` fires first. Both fail closed. A development run before the commit showed `READ_FAILED`.
- **Read cost.** SP-3's five linearizable reads took 5–14 ms each on the local three-member set.
- **M1's offline effect.** M1 also makes both offline guards fail (§5.3).

**Partition evidence.** Each run records each member's state, the term at the window, the moment before release and the moment after the decision, and the per-member entry counts. The `rs2` members' transition lines are kept in each run's directory.

### 5.2 Final gate

`npm run verify:b7` on `28e8a6cb6a17bbb828fc825717c1d6df3e7b1bc8`, clean tree, database `rs0`: **`B7 VERIFICATION PASSED`, exit 0.**

| Gate | Result (r5 in brackets) |
| --- | --- |
| Node.js 24 | PASS (v24.21.0) |
| `verify:b6` | PASS. Exit 2: the live-provider gate is PENDING by design. |
| — offline suite | 62 files: **2 341 passed**, 1 skipped (2 340) |
| — B6 / B5 / B4 gates | 460 / 236 / 584 (1 skipped), unchanged |
| — index apply and check | 12 / 12 |
| — real-database suite B2–B7 | 21 files: **225 passed**, 5 skipped, 0 failed (20 files, 225 passed, 2 skipped). The skips are RP-4 and RP-5, plus the new SP-1…SP-3, each reporting NOT RUN on a single node. |
| — B6 database gate; rehearsal | 16 / 16; 17 / 17 |
| B7 acceptance gate | **258 passed**, 1 skipped (257) |
| Coverage diagnostic | lines 71.66 %, branches 69.11 %. No threshold. |
| `npm audit --omit=dev` | 0 vulnerabilities |

`verify:b7` cannot partition a replica set, so SP-1…SP-3 run separately on the disposable `rs2` (§5.1).

### 5.3 Regression and topology runs

| Run | Commit | Result |
| --- | --- | --- |
| Offline suite | working tree = `58fd15e` code; again after the docs | 62 files: **2 341 passed**, 1 skipped |
| Offline units | `58fd15e` | 23 / 23. Two r6 guards: the five send-path reads are `linearizable` for an unknown topology, `ReplicaSetWithPrimary`, `ReplicaSetNoPrimary`, `Single`+`RSPrimary` and `Single`+`Unknown`, and use the default only for `Single`+`Standalone`; no other register read sets a read concern |
| `rs0` (single-node replica set): the six suppression files, `b6-notifications` and the stale-primary file | working tree = `58fd15e` code | 7 files: **94 passed**, 5 skipped (SP-1…3 NOT RUN; RP-4, RP-5 NOT RUN). Includes SUP-12 and the SUP-24 positive controls |
| `rs1` (three nodes: primary, hidden member, readable secondary): read preference RP-1…RP-5 and consistency | `58fd15e` | **39 / 39**; RP-5 zero submissions |
| Standalone (`:27028`, test commands enabled): the same seven files | `d8a7338` | **93 passed**, 5 skipped, **1 failed: SUP-14, pre-existing and unrelated** (§8) |
| Topology probe (real driver, empty registers) | `58fd15e` | `rs0` → `linearizable` on the wire for all five reads; `rs0` member with `directConnection` → `linearizable`; standalone and standalone `directConnection` → no read concern sent, result `local` |

### 5.4 What covers the brief's ordering

- The ordering is covered by **SP-1 on the corrected commit**. Its stale-primary window was established each time: both members writable, the new primary in a higher term, and the stale primary holding zero suppression entries. The suppressed recipient received **zero** SMTP submissions.
- No **existing** control covered this ordering on `921c299`:
  - the r5 primary reads chose the stale primary, because it reported itself writable;
  - the r4 stamps were equal, because nothing changed on A;
  - the claim was already majority-committed.

### 5.5 Execution evidence (private; referenced by hash)

Delivered as `valida-b7-r6-evidence.tar.gz`. It is not committed and not for publication. Data are synthetic only, and a scan found no address, digest, key or credential. Commands are recorded by name, collection, serving member and read concern, never by filter.

| File | SHA-256 |
| --- | --- |
| `head/stale-primary.json` / `.txt` (§3, `921c299`: SP-1 FAILED, RCPT 1 → 2) | `f0d0a3cc3aad1d533a713c23143480b72766003984357ca6c8837574c0143524` / `99f0e4f5434d0a410afd09d69f775eb7b26e56ee3e16ffc28a3b83e9f0dfcd08` |
| `head/sp1-evidence.json` (§3 timeline) | `187836a92b7bfd476d4ef4b58bce8fc45ea7ed6df2b747dd9b7948f05794524c` |
| `final/commit-d8a7338/evidence.jsonl` / `stale-primary.json` (§5.1 final) | `f220ea584f6f8bf73d01afc4221fc8486e047c9cde6b5bcefb90b874d5f8b5b3` / `fefd26360785e2a64f0d0db5b986036f35735cbbf04f0d544e0904d7ae944cba` |
| `final/commit-d8a7338-repeat2/evidence.jsonl`, `…-repeat3/evidence.jsonl` | `6a095c2018463e504c3bc525c932c504c69f7ff81448261a7caa0a5f736656d4`, `4c467442c901ab76c7e725a749063b0a992b0bb882d009a7866dfa5f73734303` |
| `final/commit-58fd15e/evidence.jsonl` (the fix commit, before the after-heal step was added) | `fe92697380e12733e8133a83d3eed0d3b316680e658ca4d7686e6e24c83d6735` |
| `final/mutation-M1/evidence.jsonl`, `units.txt`, `mutation-M1.diff` (§5.1) | `434a592e5b73089643539c6bcffb81166fd0f07511edd1c8cda5806e847c118b`, `02a0fc067dafc53b97ed2653028f23a1217d6a919ecc6ef4589587d0b3413082`, `a833e56d559ce9a8771f8c35b7ed1955da8b612d74ca303e996fa9bd68ce497d` |
| `final/verify-b7.log` (§5.2) | `958d86fc8c6be5d58fc1dfc3cf6f76fb6f3a4076e4a081815a57dbc03efd19a8` |
| `final/rs1.json` (§5.3) | `efe970464e991a9c7dd2ed0547a87e7858402e81cb75da0a0b1cc77a43c2577d` |
| `final/standalone.json` / `.txt` (§5.3) | `cae3ae4efe6fca09f2f8c3c35b1a90a1522245771a6ca940ccfa8974808ea913` / `23dbcf41bfeb77c8c778d69f82b7c9e7bd9cbbe90a44a77ca47b90a35c002d20` |
| `final/topology-probe.txt` (§5.3) | `c473cccd912b3ffa77043003b9ae195e7e57ec3cea4eff07a8d093006a48b2cf` |
| `dev/standalone-sup14-at-921c299.txt` (§8) | `9ca6bafa96951b11ea0365bfbed2431f804f142301ad6070ab3d3919e06c164e` |
| `dev/rs0-suppression.txt`, `dev/offline.txt` (§5.3) | `752ef3861dcfedd3a17af46de9dbba2bb4946afc5f1f8beab1513934e0d70533`, `3dbd0814ecad876e25a00caf0fc430dca55a796d34d53fcb9a5a2f378d11c352` |
| `scripts/reset-rs2.sh`, `run-stale.sh`, `topology-probe.mjs` | `3c04da718f5dab0b8ca87b91d11018d07911ece9adf5da3617f361aa9aeea94a`, `c0136d20c54b111665f942541d494330a015357dd0b18d32b174d1a9cc9e3b9a`, `a22cbd071fe5af3041b0f09eb1f0c0484aee55497bc5f76a8cfe1554e3dff4d6` |
| `MANIFEST.sha256` (every file in the archive) | inside the archive |
| The archive itself | `54bf61da271822dd614982ac81a1efa5d81f3b6c14ef5c7eff935715b2218a6f` |

## 6. For confirmation

1. **Linearizable on the send path.**
   - Cost: one majority confirmation per read, about three replication round trips per check (stamp; three reads in parallel; stamp).
   - On a production cluster, a check that cannot be confirmed within `SUPPRESSION_LOOKUP_TIMEOUT_MS` (default 2 000 ms) defers the acknowledgement as TRANSIENT; it never sends.
   - Is that default appropriate for the production topology? That decision is left to GPT and the owner.
2. **Scope of MongoDB's guarantee.**
   - MongoDB documents linearizable guarantees for filters that uniquely identify a single document. The register's multi-document reads rely here on the per-read primary confirmation: a linearizable read "confirms with secondary members that the read operation is reading from a primary that is capable of confirming writes with `{ w: "majority" }`".
   - Concurrent writes stay governed by the r4 stamps and by the approved SUP-12 boundary: an add not yet acknowledged when the lookup starts may be missed, and a submitted message cannot be recalled.
   - Linearizable reads are unavailable in causally consistent sessions. The register uses none.
3. **Operator reads stay `local`.** They do not authorise a send, and the operator's writes need a majority anyway.
4. **Not covered.**
   - Sharded deployments are not tested.
   - Other repositories (the Apply path's Application reads) are unchanged, as in r5.
5. **The test-only variable.** `MONGODB_TEST_PARTITION_NODES` takes three fresh loopback `mongod` addresses, used only by the stale-primary cases. An already-initiated set that is not the test's own `rs2` on the bridge addresses is refused.

## 7. Open items (unchanged)

- GPT review of r6, then the owner's confirmation of design rev 8.3, rev 8.4 and rev 8.5.
- The Windows / MongoDB verification, held for the final, independently reviewed version.
- C6 prerequisites: the production key; the key-copy location (**AWAITING INPUT**); operator tokens; the inventory's AWAITING production inputs.
- Retention (Doc 13 §187) and the Privacy Notice: **AWAITING**.
- Removing the production refusal needs a separate owner decision.

## 8. Known issue (pre-existing; not changed in this round)

**SUP-14 fails on a standalone server started with test commands.**

- **The test:** `tests/db/b7-suppression-register.test.js` › SUP-14, "a connection killed during the conditional write…".
- **Where it fails:** the same failure on the unmodified `921c299` (`standalone-sup14-at-921c299.txt`).
- **Cause:** the case arms the `failCommand` fail point **twice**, because it expects the driver's retryable-write retry to use the second activation. A standalone server does not support retryable writes, so the second activation catches the test's own re-run, which also reports `SuppressionWriteUnknown`. The product behaviour is the expected one: an unknown write outcome is reported as unknown.
- **Why it was not seen before:** in r4 and r5 the standalone server ran without test commands, and this case reported NOT RUN.
- **Status:** it passes on every replica set and is outside the acknowledgement authorisation path. It is left for a separate, test-only correction (count the fail point's activations for the topology), so this round stays focused.
