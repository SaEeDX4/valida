# Automated-Message Copy Preservation — Design (rescoped EA-1)

| | |
| --- | --- |
| Status | **PROPOSED design only.** No runtime code, script, schema, dependency or configuration has been written or changed. **Implementation needs separate authorisation**: a candidate B7 change package, after B6 is accepted. Every test in §5 is **PROPOSED / NOT WRITTEN / NOT RUN**. |
| Revision | **rev 3** (2026-10-25), after GPT review (R3-05, R3-06): a per-attempt durable record and an explicit write order (§§3.1–3.2); a crash-boundary table in which no missing evidence is read as "safe to resend" (§3.3); recovery of hashes and object references without rebuilding bytes (§3.4); a bounded policy for an uncertain IMAP APPEND (§3.6); the rev 2 claim "no failure loses the exact message" replaced by bounded guarantees with explicit assumptions (§3.9); tests extended (§5); gate G-COPY rewritten as an activation rule (§6). The rev 2 text is preserved in the rev 2 review package. **Stage 1 correction (2026-10-26):** copy and recovery transitions are fenced by the ledger entry's own state, not by the channel's latest `attemptCount` (§3.2); new test C-28. |
| Problem | The live B6 runs submitted 6 messages through Titan SMTP, and **none appeared in `notifications@` → Sent** (addendum §6). A mailbox backup cannot recover messages that were never stored in a mailbox. |
| Scope | Outgoing backend email only: `APPLICATION_RECEIVED_INTERNAL` and `APPLICATION_ACKNOWLEDGEMENT`. Separate from the human-mailbox backup (`EMAIL_BACKUP_PROPOSAL.md`) and from the production MongoDB / resume backup (Doc 15). |
| Not claimed | **No exactly-once** submission or copying. A Sent copy does **not** prove delivery; relay acceptance is not delivery. A Message-ID does **not** guarantee exactly-once copying. No preservation beyond the assumptions of §3.9. |

## 1. Requirements carried over from r9 (unchanged)

- Application acceptance stays independent of notification failure (Doc 09 §§128–132).
- The conditional claim, attempt counts, durable writes (`w: majority, j: true`), ownership checks and retry classification of r9 remain as they are. Uncertain sends are never re-sent automatically.
- The r9 SMTP adapter's phase rule stays: a failure in the connect, session, authentication or envelope phase is definitive (nothing was submitted); in the data phase only the server's final reply is definitive, and anything else is `OUTCOME_UNKNOWN`.
- No message bodies, provider responses or secrets in MongoDB (Doc 10 §122) or in operational logs.
- Every network operation is bounded. TLS uses certificate and host-name verification, with no downgrade.

## 2. Options compared

| | **APPEND only** | **Preserved copy only** (Valida-held, not appended) | **Preserved copy + APPEND (recommended)** |
| --- | --- | --- | --- |
| What happens | After SMTP acceptance, the composed bytes are APPENDed to `notifications@` Sent over IMAP | The exact composed bytes are stored durably in private object storage **before** submission | The bytes are stored **before** submission; after acceptance they are APPENDed **from the stored copy** by a copy-only step |
| Crash between SMTP acceptance and copy | **Copy lost.** The bytes existed only in memory; recomposing gives different bytes (the Date header), and re-sending is not allowed. | Bytes retained, if preservation was confirmed before submission | Bytes retained, if preservation was confirmed before submission; the APPEND resumes later |
| APPEND failure (quota, folder, network) | Must be retried from memory → lost on restart | n/a | Pending copy recovered later; **never** a new SMTP submission |
| Visible in the mailbox, so in the owner's monthly PST backup | Yes, if it succeeded | **No** — needs its own retrieval and backup path | Yes, once appended |
| New dependencies | IMAP client and credential | Object storage namespace | Both |
| Operational load | Low, but silent losses | Low; a separate store to look after | Moderate: a per-attempt record, a copy-only command and a weekly review |

**Recommendation: preserved copy + APPEND.** It is the smallest design in which every attempt that may have been submitted has its exact bytes stored before submission (under the assumptions of §3.9), no copy failure or crash can cause an SMTP submission, and the copy lands where the approved monthly backup will capture it. It is **not** a new enterprise archive.

## 3. Design

### 3.1 Durable record per attempt — the attempt ledger (a Doc 10 change — proposed)

The ledger is a bounded array on the channel, `notifications.<channel>.attempts[]`, with **one entry per attempt**. It lives in the same Application document as the r9 channel state, so the claim and the creation of the entry are **one atomic single-document write**. It is bounded by `NOTIFICATION_RETRY_MAX_ATTEMPTS` (r9: at most 20). It holds **codes, keys, hashes, counts and times only**: no body, address, subject or provider text.

| Field | Meaning |
| --- | --- |
| `n` | Attempt number (equals the channel's `attemptCount` after the claim) |
| `attemptToken` | `<messageToken>.<nn>`: the r9 Message-ID token (32 hex characters) and the attempt number as **two digits** (`01`…`20`). The fixed width matters because IMAP `HEADER` search matches substrings: `….1` would otherwise match `….10`. Carried in the message as `X-Valida-Attempt`. |
| `objectKey` | `outbound/v1/<messageToken>/<nn>.eml`, derived from the token and recorded **before** anything is stored |
| `preserve.state` | `STARTED` → `CONFIRMED`, or `FAILED` (definitive refusal by the store) |
| `preserve.sha256`, `preserve.sizeBytes`, `preserve.hashSource` | Hash and size of the stored bytes; `hashSource` is `COMPUTED_BEFORE_WRITE` or `RECOVERED_FROM_OBJECT` (§3.4) |
| `submit.state` | `NOT_STARTED` → `STARTED` → `ACCEPTED` · `REFUSED` (definitive) · `NOT_TRANSMITTED` (definitive failure before the data phase) · `UNCERTAIN`; or `ABANDONED_BEFORE_SUBMISSION` (closed by recovery, §3.3) |
| `submit.code` | The r9 classification code |
| `copy.state` | `NONE` · `NOT_REQUIRED` · `PENDING` · `CLAIMED` · `APPEND_ISSUED` · `APPENDED` · `FAILED` (definitive IMAP `NO`) · `UNCERTAIN` · `HOLD` · `ESCALATED` |
| `copy.leaseOwner`, `copy.leaseExpiresAt` | Copy-step ownership; lease times use the database server's clock (`$$NOW`) |
| `copy.appendCount`, `copy.searchCount` | APPEND commands issued and searches made for this attempt (both bounded) |
| `copy.issuedAt`, `copy.completedAt` | When the APPEND was issued (C2) and when its outcome was recorded (C3 or a search) |
| `copy.lastSearch` | `{ at, result: FOUND_ONE / FOUND_MANY / ZERO / ERROR }` |
| `copy.imapUidValidity`, `copy.imapUid`, `copy.duplicateCopies`, `copy.lastErrorCode` | Correlation (APPENDUID, RFC 4315), reported duplicates (never deleted), fixed IMAP codes (`IMAP_QUOTA`, `IMAP_FOLDER_MISSING`, `IMAP_REJECTED`, `IMAP_AUTH_FAILED`, `IMAP_TLS_FAILED`, `IMAP_TIMEOUT`, `COPY_SOURCE_INVALID`) |
| `history[]` | Bounded (proposed: 12 entries) list of transitions `{ at, from, to, code, actor: WORKER / RECONCILER / OPERATOR, reason? }`; at the cap, further operator actions are refused rather than dropping entries |
| Times | `claimedAt`, `preservedAt`, `submitStartedAt`, `submitCompletedAt`, `closedAt` |

**Traceability.** The r9 channel fields (`status`, `attemptCount`, `lastAttemptAt`, `lastErrorCode`) keep describing the **current** state. Ledger entries are **never deleted or rewritten**: a later attempt adds a new entry, and an earlier entry only gains forward transitions and closing fields. This meets Doc 10 §141 for this history. The R3 operator history proposed in the decision package (§5.3, `operatorRetries[]`) is a separate proposal; the two are to be reconciled when either is implemented.

### 3.2 Write order per attempt

Every **W** and **C** step is a conditional single-document update with `w: majority, j: true`, and every condition names the specific ledger entry by its attempt number (a positional match on `attempts.n = n`) together with that entry's expected prior state. The two kinds of step are fenced differently:

- **Submission steps (W1–W4)** belong to the channel's current attempt. Their conditions **also** require the channel's `attemptCount = n`, so a stale or slow worker for an older attempt can never submit after a newer attempt has been claimed.
- **Copy steps (C1–C3) and every recovery transition on an entry** (closing it as `ABANDONED_BEFORE_SUBMISSION`, `HOLD`, a lease takeover, a search result, `--append-held`, `--reappend`) are conditioned **only on that entry's own state** (`copy.state`, `leaseOwner`, lease expiry), **not** on the channel's latest `attemptCount`. (Where a recovery transition also changes the channel's *current* state — for example, closing a stale current attempt so the channel becomes due again — that channel part additionally requires `attemptCount = n`.) A historical attempt therefore stays copyable, searchable and escalatable after a newer attempt exists — for example, attempt 1 was uncertain, the operator re-sent it as attempt 2, and receipt of attempt 1 is confirmed later. *(Corrected in the Stage 1 package, 2026-10-26: rev 3 conditioned every step on the channel's `attemptCount`, which would have blocked copies of earlier attempts.)*

r9 claims all due channels of an Application in one write; W1 adds one ledger entry per claimed channel in that same write, and the later steps run per channel.

```
W1  claim (r9, extended): channel → ATTEMPT_IN_PROGRESS, attemptCount n, lastAttemptAt;
    push entry n { attemptToken, objectKey, preserve: STARTED, submit: NOT_STARTED, copy: NONE }
    ── W1 failed or outcome unknown ⇒ this worker stores nothing and sends nothing (r9 rule)
compose once: exact RFC 5322 bytes (r9 headers + X-Valida-Attempt: <attemptToken>); sha256 in memory
S1  create-only write of the bytes to objectKey (refused if the key exists)
W2  preserve: CONFIRMED + sha256 + sizeBytes          (if preserve STARTED, submit NOT_STARTED, not closed)
    ── S1 refused ⇒ preserve FAILED, channel FAILED / SENT_COPY_STORE_FAILED (transient); no SMTP
W3  submit: STARTED + submitStartedAt                 (if preserve CONFIRMED, submit NOT_STARTED, not closed)
    ── W3 failed or outcome unknown ⇒ no SMTP by this worker
SMTP  only now; the buffer's sha256 is re-checked against preserve.sha256 immediately before sending
W4  submit: ACCEPTED | REFUSED | NOT_TRANSMITTED | UNCERTAIN + code; channel SENT / FAILED (r9 meaning);
    copy: PENDING (accepted) | NOT_REQUIRED (refused / not transmitted) | HOLD (uncertain)
── the HTTP response does not wait for anything below ──
C1  copy claim on entry n: PENDING (or FAILED and due) → CLAIMED, leaseOwner, leaseExpiresAt = $$NOW + L   (entry n's state only)
    read the object; verify sha256; IMAP (implicit TLS 993): LOGIN, SELECT the verified Sent folder
C2  copy: APPEND_ISSUED, appendCount + 1            (if leaseOwner = self, CLAIMED, lease not expired)
APPEND  only now
C3  copy: APPENDED (+ APPENDUID) | FAILED (tagged NO) | UNCERTAIN (no tagged reply)   (if leaseOwner = self, APPEND_ISSUED)
```

**Invariants** (each is covered by a proposed, not yet written, test in §5):

- **I1** No storage write for attempt *n* before W1 is acknowledged.
- **I2** No SMTP connection for attempt *n* before W3 is acknowledged.
- **I3** The bytes submitted are the confirmed preserved bytes (hash re-check).
- **I4** The copy step has **no SMTP code path and no SMTP credential**.
- **I5** No APPEND command for attempt *n* before C2 is acknowledged.
- **I6** A failed condition stops the worker with no network action.
- **I7** Ledger entries are append-only, as in §3.1.

**Why the APPEND is not inline:** the Apply request already waits for the bounded notification attempt (`application.submission.js`, `notifyAccepted`). An IMAP round-trip would lengthen every Apply response and add a failure path to it. A deferred copy step keeps acceptance and response independent of IMAP. The two extra writes (W2, W3) and the storage write do sit inside the bounded notification attempt; their latency must be measured, and the notification bound must cover them (an implementation-time check).

### 3.3 Crash boundaries — what survives and what recovery may do

**Two rules apply to the whole table.**

1. A classification comes only from the **positive sequence of durable ledger states**, read with majority read concern, together with invariants I1–I6. It never comes from the presence of an object in storage, and never from the absence of a final outcome.
2. **Missing evidence is never converted into "safe to resend".** Anything from W3 onwards without a definitive outcome is treated as *submission may have started*.

| # | Crash point | Durable evidence that survives | Classification | Permitted automatic recovery | Permitted operator action | Never |
| --- | --- | --- | --- | --- | --- | --- |
| K0 | Before W1 is acknowledged | None, or W1 committed anyway (then K1) | No attempt, if no entry exists | The normal r9 policy for the channel | — | — |
| K1 | After W1; S1 not done or its outcome unknown | Entry *n*: `preserve STARTED`, `submit NOT_STARTED`. An object **may or may not** exist at `objectKey`. | **Preservation not confirmed; submission not started** (from `submit NOT_STARTED` and I2 — not from the object) | Once the claim is stale under the r9 rule, the reconciler closes entry *n* as `ABANDONED_BEFORE_SUBMISSION` with a conditional write on the same state, which fences a slow worker out of W2/W3. An object found at the key is kept and reported as "object of attempt *n*; the ledger shows submission not started". The channel then follows the normal transient policy: a **new** attempt *n+1* with its own token and key. | — | Never append or submit that object's bytes; never treat the object as proof of anything about submission |
| K2 | After S1 succeeded, before W2 | As K1; the object exists, but the ledger has no hash | As K1 | As K1. The reconciler may record the object's hash with `hashSource: RECOVERED_FROM_OBJECT` (§3.4). | — | Never recompose the bytes |
| K3 | After W2, before W3 | `preserve CONFIRMED` (key, hash); `submit NOT_STARTED` | **Preserved; submission not started** (I2) | As K1: close as `ABANDONED_BEFORE_SUBMISSION` once stale; a new attempt follows the normal policy | — | Never reuse attempt *n*'s bytes for another attempt |
| K4 | After W3, before the SMTP connection opens | `submit STARTED`; the key and hash of the exact bytes | **Submission may have started.** The ledger cannot tell K4 from K5 or K6. | **None.** The channel reads `UNCERTAIN` (r9 stale `ATTEMPT_IN_PROGRESS`); the copy is `HOLD`. | Resolve as in the bounce procedure §4.7. If receipt is confirmed (for the internal notification: the message with that `X-Valida-Attempt` token is in `hr@`), `--append-held` may append that attempt's stored bytes, with a reason. A re-send is only the r9 operator choice `--include-uncertain`, with its duplicate risk recorded; it creates a new attempt. | Never re-send or append automatically |
| K5 | During SMTP data, with no final reply | Same as K4 | Same as K4 | Same as K4 | Same as K4 | Same as K4 |
| K6 | Relay accepted (`250`), but W4 was never written | Same as K4. Acceptance was known only to the stopped process; a log line, if any, is supporting evidence, not durable state. | **Relay accepted but final write missing** — indistinguishable from K4/K5 in durable state, so **uncertain** | Same as K4 | Same as K4; a log line may support the operator's decision | Same as K4 |
| K7 | W4 sent; its outcome unknown | Either W4 committed, or the state is K6 | Re-read with majority read concern before any decision | — | — | Never guess |
| K8 | After W4 = `ACCEPTED`, before C1 | `copy PENDING` | Copy pending | The copy step claims it | — | Never SMTP |
| K9 | After C1 (`CLAIMED`), before C2 | `copy CLAIMED` with an expired lease | **No APPEND issued** (I5) | After lease expiry, the reconciler returns it to `PENDING`, conditional on the same lease owner and state. A worker that resumes then fails C2 and never sends APPEND. | — | — |
| K10 | After C2 (`APPEND_ISSUED`), before C3 | `copy APPEND_ISSUED` with an expired lease | **APPEND may have been issued, and may still complete later** | After lease expiry: → `UNCERTAIN`, conditional on the lease, which fences the old worker's C3. Then the uncertain-APPEND policy (§3.6). | §3.6 | **No automatic re-APPEND** |
| K11 | C3 sent; its outcome unknown | Either C3 committed, or the state is K10 | Re-read before any decision | — | — | — |

**A database write never cancels a remote operation that was already issued.** Fencing only stops a stale worker from recording a result or starting a new network action. An SMTP DATA or IMAP APPEND that was already sent can still complete.

### 3.4 Recovering hashes and object references — without rebuilding bytes

- **Object reference.** `objectKey` is deterministic from the attempt token and is written in **W1**, before any storage write. A crash at any later point therefore leaves the key in the ledger.
- **Hash.** It is normally written in **W2** (`COMPUTED_BEFORE_WRITE`). Every attempt that reached W3 has it, because W2 precedes W3.
- If the process stopped between S1 and W2 (K2), the reconciler may **read the stored object**, compute its SHA-256 and size, and record them with `hashSource: RECOVERED_FROM_OBJECT`. That proves only what is stored. It does not matter for submission, because W3 never happened.
- **Bytes are never recomposed.** A rebuilt message would differ (the Date header at least) and would not be the message that was, or might have been, sent.
- **No ledger entry, but an object exists** (for example, a manual restore of storage without the database): the object is **unclassified** — reported, held, never appended or sent.

### 3.5 Submission state and the r9 channel state

| Ledger `submit.state` | r9 channel state | Meaning |
| --- | --- | --- |
| `NOT_STARTED` (live claim) | `ATTEMPT_IN_PROGRESS`, recent | In flight; not due |
| `NOT_STARTED` / preserve not confirmed, stale | `ATTEMPT_IN_PROGRESS`, stale → closed `ABANDONED_BEFORE_SUBMISSION` | Provably not submitted (K1–K3); a new attempt follows the transient policy |
| `STARTED`, stale | `ATTEMPT_IN_PROGRESS`, stale → `UNCERTAIN` | May have been submitted (K4–K6); operator only |
| `ACCEPTED` | `SENT` | Relay acceptance only — never "delivered" |
| `REFUSED` | `FAILED`, permanent code | Not sent; copy `NOT_REQUIRED`; the bytes are kept as attempt evidence |
| `NOT_TRANSMITTED` | `FAILED`, transient or configuration code | Not sent (definitive, before the data phase) |
| `UNCERTAIN` | `FAILED`, `OUTCOME_UNKNOWN` / `TIMEOUT` | May have been accepted; copy `HOLD` |

**Change from r9, stated plainly:** r9 treats every stale `ATTEMPT_IN_PROGRESS` as uncertain. With the ledger, a stale attempt whose durable state shows `submit NOT_STARTED` becomes provably unsubmitted and may be retried under the **transient** policy. This narrows the uncertain set without weakening it: anything from W3 onwards stays uncertain.

### 3.6 The copy step and an uncertain APPEND

**Chosen policy: conservative hold, with bounded searching and escalation.** It is not bounded automatic re-APPEND.

- **Why:** the authoritative preserved copy is the stored object, which is already durable before submission. Delaying the mailbox copy therefore costs no preservation. An automatic re-APPEND would trade an unknown for a duplicate risk.
- **The difference from a definitive failure:** a tagged IMAP `NO` means the APPEND did not happen. `FAILED` is therefore retried automatically with backoff (C-02); there is no duplicate risk in that case.

**Rules for `UNCERTAIN`:**

1. **No automatic re-APPEND**, ever.
2. **Search, after a quiet period.** The first search runs no earlier than *Q* after the APPEND was issued (proposed *Q* = 15 minutes). At most *K* further searches follow, at increasing intervals, within a window *W* (proposed *K* = 3, *W* = 24 hours). All three values are configurable and bounded.
3. **The search command:** `UID SEARCH HEADER X-Valida-Attempt "<attemptToken>"` in the verified Sent folder only.
   - The fixed-width token avoids substring matches (§3.1).
   - Whether Titan indexes this header reliably is **to be verified live**. If it does not, the fallback is: search by the Message-ID (shared by all attempts), then fetch **only** `BODY.PEEK[HEADER.FIELDS (X-Valida-Attempt)]` of the matches. That is never a body, and `.PEEK` sets no `\Seen` flag.
4. **Reading the result:**

   | Search result | Copy state | Notes |
   | --- | --- | --- |
   | Exactly one match | `APPENDED` (UID recorded) | — |
   | More than one match | `APPENDED` + `duplicateCopies` | Reported; never deleted |
   | **A successful search with zero results** | **Stays `UNCERTAIN`**; the result is recorded with its time | Not evidence of absence: the earlier APPEND may complete later, or the index may lag |
   | **A search error** (`NO`, `BAD`, a timeout, a dropped connection, a sign-in failure) | `ERROR` recorded; **no conclusion** | Searched again later, within the bound |

5. **Escalation.** When the window ends without a match, the state becomes `ESCALATED` and the attempt appears in the weekly review (the reviewer is **AWAITING INPUT**). The operator chooses one of:
   - **(a)** leave it unresolved, with the stored object as the authoritative copy and no mailbox copy;
   - **(b)** `--reappend <application>:<channel>:<n> --reason …`: exactly one APPEND, **accepting the duplicate risk**, recorded in `history[]`. If the original APPEND completes later, the duplicate is found by a later search and reported.

   **Neither choice can submit SMTP** (I4).
6. **Overlapping workers.** The conditional copy claim admits one worker. A reconciler that finds an expired lease **never APPENDs**: it only moves the state (K9 → `PENDING`, K10 → `UNCERTAIN`), and those moves are themselves conditional. **Exactly-once is not promised.**

### 3.7 Failure matrix (failures other than crashes; crashes are §3.3)

| # | Situation | Submission | Copy | Automatic action | Operator action |
| --- | --- | --- | --- | --- | --- |
| 1 | Composition fails (template) | `FAILED` / `TEMPLATE_ERROR` (configuration) | `NONE` | none | Fix the cause, then `--include-configuration` |
| 2 | The store refuses the write (definitive) | `FAILED` / `SENT_COPY_STORE_FAILED` (transient); **nothing sent** | `NONE` | Normal transient retry, as a new attempt | Storage incident if it persists |
| 3 | The store's outcome is unknown (timeout) | Entry stays `preserve STARTED`, `submit NOT_STARTED`; **nothing sent** (I2) | `NONE` | As K1 once stale | — |
| 4 | SMTP accepted | `SENT` | `PENDING` | The copy step appends | — |
| 5 | SMTP refused (definitive) | `FAILED` (r9 code) | `NOT_REQUIRED`; the bytes are kept as attempt evidence | r9 policy | r9 policy |
| 6 | SMTP failed before the data phase (definitive) | `FAILED` (r9 code), `NOT_TRANSMITTED` | `NOT_REQUIRED` | r9 policy | r9 policy |
| 7 | SMTP uncertain (data phase, no final reply) | `UNCERTAIN` (r9) | `HOLD` | **none** | As K4 |
| 8 | APPEND OK | unchanged | `APPENDED` | — | — |
| 9 | APPEND `NO`: quota, folder missing, rejected | unchanged | `FAILED` + code | The copy step retries with backoff (bounded); **SMTP never** | Quota or folder problems are escalated |
| 10 | IMAP authentication or TLS failure | unchanged | `FAILED` (configuration) | One failed login latches further logins until restart, as the SMTP adapter does | Fix the credential or certificate issue |
| 11 | APPEND uncertain (no tagged reply in time; connection lost after the literal) | unchanged | `UNCERTAIN` | §3.6 — search only | §3.6 |
| 12 | Stored bytes missing, or hash mismatch | unchanged | `FAILED` / `COPY_SOURCE_INVALID`; **never appended** | none | Integrity incident |
| 13 | The Sent folder cannot be identified (SPECIAL-USE `\Sent`, or the configured name) | unchanged | `FAILED` / `IMAP_FOLDER_MISSING` | none — no guessing | Verify the folder and configure it |
| 14 | Two copy steps at once | unchanged | The conditional claim admits **one** | — | — |

**Correlation:** every attempt carries a distinct, fixed-width `X-Valida-Attempt` token in its bytes, so a Sent copy, a bounce or a duplicate can be tied to **one attempt**. The Message-ID is shared by all attempts of one logical message (r9); it correlates the message but **cannot** prove exactly-once copying.

### 3.8 Storage, access, privacy

| Aspect | Design |
| --- | --- |
| Where | **Private object storage**, through the existing B4 storage boundary: a **separate namespace** (bucket or prefix) and **its own credential**. **Durable local disk on the C6 host is not assumed.** Development uses a local driver with synthetic data only. |
| Access | Backend: create and read under `outbound/` only — **no delete, no overwrite, no list outside the prefix** (to verify that the C6 provider can scope a credential this way; Doc 13 §101). Operators: a documented read path for recovery, separate from the backend credential. Public access off (OPS-021). |
| Encryption | At rest as the storage provider supports it (OPS-056); TLS in transit |
| Quotas | Storage: small (a message is a few KB). **Titan mailbox quota:** Sent in `notifications@` grows; `IMAP_QUOTA` failures are visible and escalated. |
| Privacy | The bytes contain the candidate's address and the Job title; they are personal data. Add them to the provider / data inventory (Doc 13 §§197–198). Include them in the coordinated Application deletion workflow (Doc 13 §190). |
| Cleanup | **None now.** Deletion happens only under an approved retention or privacy decision (Doc 13 §187 — AWAITING). No TTL, no automatic deletion, and **no implication of indefinite retention**. |
| IMAP credential | `notifications@` over IMAP, implicit TLS on `imap.titan.email:993`. **A separately named application password**, distinct from the SMTP one, so each can be revoked independently; whether Titan issues it for IMAP use is **to be verified**. **Risk:** a mailbox credential can read `notifications@`, including bounces with candidate data. The adapter only SELECTs Sent and runs APPEND, `UID SEARCH` and, in the fallback of §3.6 only, a fetch of the single `X-Valida-Attempt` header field. It **never fetches message bodies** and never touches other folders. |
| Bounds | Per-phase timeouts (connect, greeting, login, select, append, search, fetch-header) under a configurable `SENT_COPY_TIMEOUT_MS`. The copy lease *L* is longer than the sum of these bounds plus a margin. An abort destroys the socket. Classification is by phase, like the SMTP adapter's: a literal sent with no tagged reply ⇒ uncertain. |
| Availability trade-off | Submission depends on the store: if the store is unavailable, notifications are **not sent** (transient failure, retried later). Preservation is chosen over sending. Application acceptance is unaffected (r9). Readiness includes the copy store; it is **not** failed by an IMAP backlog. |
| Visibility | The `ops:notifications:retry` dry-run summary (r9) gains copy-state counts (`PENDING`, `FAILED`, `UNCERTAIN`, `HOLD`, `ESCALATED`) and the oldest age. `ops:notifications:sent-copy` reports every unresolved copy and every unclassified object. A named person reviews them weekly (**AWAITING INPUT**; not automatically Saeed). |

### 3.9 Bounded guarantees and their assumptions

The rev 2 sentence "no failure loses the exact message" is **withdrawn**. What the design does claim, under the assumptions below:

| # | Guarantee | Basis |
| --- | --- | --- |
| G1 | **No SMTP submission for an attempt unless its exact bytes were confirmed stored and the start was durably recorded first.** For every attempt whose submission may have started, the ledger holds the object key and the SHA-256 of the exact bytes. | I1–I3; W1–W3 |
| G2 | **Those bytes stay retrievable while the storage assumptions (A5–A8) hold.** | Storage durability and access |
| G3 | **No copy failure, crash or uncertainty can cause an SMTP submission.** | I4 (structural) |
| G4 | **Unknowns stay unknown.** An attempt that may have been submitted is never re-sent or appended automatically; an APPEND that may have been issued is never repeated automatically. | §3.3, §3.6 |
| G5 | **Each attempt stays traceable;** later attempts never overwrite earlier ones. | I7 |

**Not guaranteed:**

- exactly-once submission or copying;
- delivery, or that a recipient saw a message;
- that the mailbox copy persists (people can delete from Sent; the monthly backup captures only what is present at the time of each run);
- preservation if a storage assumption fails;
- any copy of messages sent before the change is deployed;
- that notifications are sent while storage is unavailable.

**Assumptions:**

| # | Assumption | Verified how / when |
| --- | --- | --- |
| A1 | MongoDB runs as a replica set with majority write concern and journaling (the r9 durable write path), and recovery decisions read with majority read concern. A standalone development server does not give these guarantees. | Configuration review at C6; tests use a replica set |
| A2 | Invariants I1–I7 hold in the code. | C-07, C-23, C-24, C-27 |
| A3 | Only this code path holds and uses the `notifications@` SMTP credential. | DEV-B6-01/02 attestation; D8 production credential |
| A4 | Lease decisions use the database server's clock (`$$NOW`), not worker clocks. | C-20, C-21 |
| A5 | The storage provider supports create-only writes (a conditional put) or an equivalent, with the durability it documents; versioning or delete protection is preferred. | C6 provider selection |
| A6 | The backend's storage credential cannot delete or overwrite under `outbound/`. | C6 permission check |
| A7 | The storage account stays paid and within quota. The `notifications@` mailbox has room for Sent copies. | Operations; `IMAP_QUOTA` escalation |
| A8 | Operators have a documented read path to the objects for recovery. | C6 runbook |

**Costs and hosting prerequisites (none provisioned; nothing purchased):**

1. A private object storage provider, and a separate namespace with its own credential: part of the C6 provider selection. Storage and request charges are expected to be small for messages of a few KB, but they are **not quantified** here; that waits for the C6 provider selection.
2. Outbound IMAPS (TCP 993) from the backend host to `imap.titan.email`.
3. A scheduler for `ops:notifications:sent-copy`, or a documented manual cadence.
4. Secret storage for the IMAP credential.
5. Operator time for the weekly review (the person is **AWAITING INPUT**).

No enterprise archive, paid archive service or retention product is proposed.

## 4. Proposed configuration and document changes (all PROPOSED; locations as found in the baselined documents)

| Document | Location | Change |
| --- | --- | --- |
| Doc 10 | After §122 (notification state stores classifications only) | The `attempts[]` ledger (§3.1) and its bounds; new storable codes (`SENT_COPY_STORE_FAILED`, the `IMAP_*` copy codes, `ABANDONED_BEFORE_SUBMISSION`) |
| Doc 09 | After §134 (controlled retry mechanism) | The operator command `ops:notifications:sent-copy`: dry run by default; `--apply`; `--limit`; `--append-held <application>:<channel>:<n> --reason …`; `--reappend <application>:<channel>:<n> --reason …`. Never exposed over HTTP. |
| Doc 14 | After §178 (transactional email logs) | The Sent-copy behaviour for the SMTP mailbox provider; the IMAP credential, its scope and risk; the `X-Valida-Attempt` header |
| Doc 15 | §54 lists only configuration **categories**; no variable list was found in Doc 15, although Doc 14 §180 says the exact variables "are finalized in Document 15". Proposed: add a variable list next to §54, together with AMD-B6-08. | `IMAP_HOST`, `IMAP_PORT`, `IMAP_USERNAME`, `IMAP_PASSWORD` (secret), `SENT_COPY_FOLDER` (or SPECIAL-USE discovery), `SENT_COPY_TIMEOUT_MS`, the quiet period / search count / window of §3.6, and the outbound-copy storage settings |
| Doc 13 | §§197–198 (provider / data inventory); §190 (deletion workflow) | Inventory, privacy and deletion coordination (§3.8) |
| Doc 17 | New QA cases (Phase 1 notification area) | The tests in §5 |
| Doc 18 | C6, new §180A, after §180 | Gate G-COPY (§6), only if approved |

## 5. Proposed tests — PROPOSED / NOT WRITTEN / NOT RUN

Synthetic data only; local SMTP and IMAP test doubles; a MongoDB replica set; a storage double; nothing live.

| # | Test |
| --- | --- |
| C-01 | **Happy path:** preserve → SMTP 250 → `SENT` + `PENDING` → copy step → `APPENDED`. The bytes received by the SMTP double **equal** the stored object and the bytes APPENDed (SHA-256). |
| **C-02** | **SMTP succeeds, then APPEND fails** (`NO [OVERQUOTA]`): the copy is `FAILED` / `IMAP_QUOTA`, and a later copy run appends **once**. **The SMTP submission counter stays at exactly 1 throughout: zero additional submissions.** |
| C-03 | The store refuses the write → **zero** SMTP submissions; channel `FAILED` / `SENT_COPY_STORE_FAILED`; the Application still returns `201` |
| C-04 | **(corrected)** The store's outcome is unknown (timeout) → the entry stays `preserve STARTED` / `submit NOT_STARTED`; zero SMTP. Recovery reports any object at the key as "object of attempt *n*; the ledger shows submission not started" — **classified from the ledger, never from the object**. The object is never appended or sent; the next attempt has a new token and key. |
| C-05 | SMTP refused (`550`) → `REFUSED`, copy `NOT_REQUIRED`; nothing appended; the bytes are kept |
| C-06 | SMTP uncertain (connection dropped after DATA) → `UNCERTAIN`, copy `HOLD`; no APPEND and no re-send by any automatic run |
| C-07 | **Crash harness:** the process is killed after each of W1, S1, W2, W3, SMTP 250 (before W4), W4, C1, C2 and APPEND (before C3). The resulting classification matches K0–K11 (§3.3). At most one SMTP submission per attempt; no automatic submission or APPEND for K4–K6 or K10. |
| C-08 | **(revised)** APPEND uncertain → no immediate re-APPEND. After *Q*, a search finding one match ⇒ `APPENDED` with no second APPEND. Zero results ⇒ stays `UNCERTAIN` and the next search is scheduled. The window exhausted ⇒ `ESCALATED`. The APPEND count stays 1. |
| C-09 | Duplicates: the search returns 2 → `APPENDED` + `duplicateCopies = 2`; nothing deleted |
| C-10 | Two concurrent copy steps → exactly one claim and one APPEND |
| C-11 | Stored bytes altered (hash mismatch) → `COPY_SOURCE_INVALID`; no APPEND |
| C-12 | TLS: wrong host name or untrusted certificate → no LOGIN sent; `IMAP_TLS_FAILED`; then the latch behaviour |
| C-13 | Every IMAP phase is bounded; an abort settles within the grace time |
| C-14 | No bodies or addresses in MongoDB documents or logs (the existing scans extended to the ledger) |
| C-15 | `X-Valida-Attempt` differs per attempt while the Message-ID stays the same; tokens are fixed-width, so the token of attempt 1 does not match a search for attempt 10, nor the reverse |
| C-16 | The Sent folder is unresolvable → `IMAP_FOLDER_MISSING`; nothing appended to any other folder |
| C-17 | `--append-held` requires a reason, appends only the named attempt, once, and records the history |
| C-18 | Regression: the full r9 notification suites unchanged (claim, retry, replay, R3 behaviour) |
| **C-19** | **Late APPEND completion:** the IMAP double accepts the literal, drops the connection without a tagged reply, and makes the message visible only after a delay longer than *Q*. The first search returns zero → `UNCERTAIN` kept, no re-APPEND. A later search returns one → `APPENDED`. **APPEND commands in total: 1. SMTP submissions: 1.** |
| **C-20** | **Overlapping workers, expired lease after the APPEND was issued:** worker A reaches `APPEND_ISSUED` and stalls past its lease. The reconciler moves the copy to `UNCERTAIN`. Worker A resumes and receives `OK`; its C3 write is rejected (fenced) and it takes no further action. A later search → `APPENDED`. APPEND: 1; SMTP: 1. |
| **C-21** | **Overlapping workers, expired lease before the APPEND:** worker A stalls after C1. After lease expiry the reconciler returns the copy to `PENDING`. Worker A's C2 is rejected, so it never sends APPEND; worker B appends once. APPEND: 1. |
| **C-22** | **A search error is not zero results:** `NO`, `BAD`, a timeout or a dropped connection → `ERROR` recorded, no state conclusion, no re-APPEND. A successful empty search → `ZERO` recorded, still `UNCERTAIN`. |
| **C-23** | **Ordering invariants:** instrumented doubles prove no storage write before W1 is acknowledged, no SMTP connection before W3 is acknowledged, and no APPEND before C2 is acknowledged. A W3 failure or unknown outcome ⇒ zero SMTP; a W1 failure ⇒ nothing stored or sent. |
| **C-24** | **A slow worker against the reconciler (K1, K3):** the reconciler closes entry *n* as `ABANDONED_BEFORE_SUBMISSION`. The worker's W2 or W3 is rejected, so attempt *n* has zero SMTP submissions; attempt *n+1* proceeds once. |
| **C-25** | **Hash recovery (K2):** the hash is recorded from the stored object with `RECOVERED_FROM_OBJECT`; the bytes are never recomposed; the attempt is closed as not submitted. |
| **C-26** | **Operator re-APPEND after escalation:** a reason is required; exactly one APPEND; the duplicate risk is recorded; the SMTP count is unchanged. |
| **C-27** | **Ledger bounds and traceability:** `attempts[]` never exceeds the configured maximum; earlier entries are unchanged after later attempts (snapshot comparison); enums and the `history[]` cap are validated. |
| **C-28** | **A historical attempt stays copyable after a newer attempt exists:** attempt 1 ends `UNCERTAIN` / `HOLD`; the operator re-sends (attempt 2, `SENT`, copy `APPENDED`); receipt of attempt 1 is then confirmed and `--append-held` appends attempt 1's stored bytes **once**. Attempt 2's entry is untouched; no write is rejected merely because `attemptCount` is now 2; SMTP submissions in total: 2 (both operator-visible), none caused by copying. |

**Live Titan verification** (separately authorised later): Sent-folder discovery; APPEND of a synthetic message; `UID SEARCH HEADER` for the attempt token, including indexing delay; APPENDUID support; quota behaviour; whether an application password works for IMAP alongside 2FA.

## 6. Milestone and activation gate

| Item | Proposal |
| --- | --- |
| Milestone | **A candidate B7 change package**, separately authorised **after B6 acceptance**. B7 is the backend failure gate, and this changes failure handling. This proposal is **not** permission to begin. |
| Authority | **G-COPY is a proposed gate, not an approved canonical requirement.** It binds only if the owner approves it under Doc 00 §5 and Doc 18 §364 (change control), and it is inserted into Doc 18 as below. Until then it is a recommendation recorded in decision D6a. **It is not a B6 acceptance criterion and does not block B6.** |
| States kept separate | B6 acceptance · backup setup readiness (owner's task) · implementation of this design (B7 candidate) · production activation (C6 / C7). Approval of one never implies another. |

**Gate G-COPY — activation rule (PROPOSED):**

- **Blocked operation.** Enabling production sending of automated notification email: running the production environment with `TRANSACTIONAL_EMAIL_PROVIDER=smtp` for either event (`APPLICATION_RECEIVED_INTERNAL` or `APPLICATION_ACKNOWLEDGEMENT`) — that is, any notification sent by production in Doc 18 C6 or C7, including the C7 synthetic application.
- **Evidence that satisfies it — all three are required:**
  1. this design (or an approved revision) is implemented in an authorised milestone, and its tests (§5) pass with **execution evidence**, not with test files alone;
  2. a separately authorised live Titan check passes: Sent-folder discovery, an APPEND of a synthetic message, and a header search finding its attempt token;
  3. the production storage namespace exists with its scoped credential, and the access checks of §3.8 pass.
- **Exception — proposed mechanism only; none has been approved.** The owner could record a separate, explicit decision that production may send before G-COPY is satisfied, accepting that those automated messages have **no preserved copy**. Such an exception would be its own dated owner-decision record. **Neither B6 acceptance, nor this document, nor approval of D6a creates it.**
- **Independence from G-SUP.** G-COPY and G-SUP (decision package D2a) are independent. Satisfying one never satisfies or weakens the other:
  - candidate acknowledgements in production need **both**;
  - the internal notification needs G-COPY only.

**Proposed canonical amendment (NOT approved):**

> **AMD-COPY-01 — Doc 18, Milestone C6, new §180A "C6 AUTOMATED-MESSAGE COPY GATE (G-COPY)".** Production must not send automated notification email (`TRANSACTIONAL_EMAIL_PROVIDER=smtp` in production, for any notification event) until: (1) automated-message copy preservation — the exact message stored before submission, a per-attempt durable record, and a copy-only IMAP APPEND to the sending mailbox's Sent folder that can never cause a new submission — is implemented in an authorised milestone and its acceptance tests pass with execution evidence; (2) a live provider check of folder discovery, APPEND and attempt-token search passes; (3) the production storage namespace and its scoped credential are verified. Alternatively, the owner records a separate, explicit exception accepting that production automated messages sent before these conditions are met have no preserved copy. This gate is independent of the suppression gate for candidate acknowledgements (G-SUP).
