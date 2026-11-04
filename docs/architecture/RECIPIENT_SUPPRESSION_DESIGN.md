# Minimal recipient suppression for candidate acknowledgements — design (D2a)

| | |
| --- | --- |
| Decision | D2a: **APPROACH APPROVED — DESIGN / IMPLEMENTATION / VERIFICATION PENDING** (OD-2026-10-26-01). This is **not** a suppression exception, and it does not open gate G-SUP. |
| Status of this document | **PROPOSED design.** Nothing of the register, lookup, commands or key handling is implemented, and every SUP test in §8 is **NOT WRITTEN / NOT RUN**. The only B7 code change is the production start-up refusal of acknowledgements (rev 7, `ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`, tested in `backend/tests/b7-acknowledgement-gate.test.js`), which keeps G-SUP closed and chooses no design detail. |
| Milestone | A bounded **B7** change, after B6 acceptance and separate B7 authorisation (Stage 4). Not bundled with the template revision (Stage 2), R3, the message-copy work or the body-discard fix. |
| Governing text | Doc 14 §§117–121, 167; MAIL-042, MAIL-043, MAIL-044; Doc 09 §§128–136; Doc 10 §§84–85, 117–122, 139, 141; Doc 13 §§118–121, 177–178, 186–187, 190; decision package DEV-B6-04 (SUP-1…6, G-SUP) |
| Gate | **G-SUP stays closed** until this design (or an approved revision) is implemented and SUP-1…6, plus the focused cases of §8, pass with execution evidence. No exception is approved. |
| Revision | **rev 5** (2026-10-26, after GPT's review of rev 4). The key lifecycle is now **fail-closed**: retiring, losing or failing to migrate a key never lifts a suppression; acknowledgements are blocked while coverage is incomplete; unrecoverable entries need an explicit, audited owner decision (§1, §3.1, §3.2, §3.4, §4.2, §4.3, new §4.4, §5). The acknowledgement budget moved to a separate proposal ([`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md), decision D2b) (§5, §7.2). §8: SUP-16 revised, SUP-17 withdrawn, SUP-18…21 added. Nothing else changed. |
| Revision | **rev 6** (2026-10-26, OD-2026-10-26-02): new §4.5 registers an **OPEN** key-material integrity requirement, with SUP-22 to be specified; a note in §4.4; the escalation wording in §2. This is an open design and test requirement — not an implemented safeguard, and not an approval of this design. |
| Revision | **rev 7** (2026-11-04, B7, OD-2026-11-04-01): §4.5 now holds a **PROPOSED** key-material integrity design (key check values) and SUP-22 is **specified** (SUP-22a–f), for owner approval; §6 records that the SUP-1 amendment was **APPROVED** with DEV-B6-04 (OD-2026-11-02-03). Production start-up already refuses `APPLICATION_ACKNOWLEDGEMENT_ENABLED=true` (B7, rule `ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`), the minimal form of the §3.2 start-up refusal. Nothing else in this design is implemented, and no design detail is approved by this revision. |

## 1. What it must do — and what it cannot do

**Must:**

- stop **future candidate acknowledgements** to an address that has been **confirmed** permanently invalid, across distinct Applications;
- leave Application acceptance (`201`) and the independent internal notification untouched;
- keep idempotency, ownership checks, durable writes, bounded operations and the r9 retry rules;
- record confirmed asynchronous hard bounces through a controlled operator workflow;
- correlate by the returned Message-ID / attempt evidence and resolve the address from the **stored** Application — never from a pasted address;
- keep add / lift history (actor, reason, time, evidence reference) without message content or plaintext addresses in logs;
- require a reason and evidence to lift, and never resend old acknowledgements when lifting;
- never let a lost key, an incomplete key migration or an unavailable historical key make a suppressed address eligible again without an explicit, audited decision (§4.4).

**Cannot:**

- prevent the **first** bounce to any address;
- prevent **fresh** invalid addresses (a different typo, or an attacker using new addresses);
- prevent a **burst** that arrives before a person reviews it;
- recall a message already submitted.

§7 covers what remains of those risks.

## 2. Classification — conservative; no "all 5xx means invalid" rule

| Class | Typical evidence | Suppression |
| --- | --- | --- |
| **Confirmed recipient-specific permanent invalid address** | Enhanced status **5.1.1** (bad destination mailbox), **5.1.2** (bad destination system / domain), **5.1.3** (bad destination address syntax) or **5.1.10** (recipient has a null MX, RFC 7505) — on the relay's `RCPT TO` refusal, or in a DSN's `Status:` for that recipient, **and** correlated to one acknowledgement attempt | **Eligible** — reason `INVALID_RECIPIENT_CONFIRMED` |
| Domain does not exist, shown only as text (for example "Host or domain name not found … Host not found"), with no 5.1.x status | Rendered DSN text only | **Review required.** The operator may record it as 5.1.2 only when the DSN states a **permanent** failure and names a name-service "Host not found" result for that recipient's domain; a "try again" or temporary DNS failure is never eligible. |
| Temporary failure; mailbox full; greylisting; deferral | 4.x.x; 5.2.2 / 4.2.2; "delayed" DSNs | **Not eligible** |
| Network failure; timeout; unknown outcome | r9 `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `OUTCOME_UNKNOWN`, stale `ATTEMPT_IN_PROGRESS` | **Not eligible** |
| Sender-side: authentication, sender policy, DMARC / SPF, reputation, quota, rate limits, message size | 5.7.x; `MAIL FROM` refusal (`SENDER_NOT_VERIFIED`); `PROVIDER_AUTH_FAILED`; 5.3.4; provider rate or bounce-limit messages | **Not eligible — an operational incident** (escalate on the same calendar day as discovery) |
| Ambiguous provider response | A 5xx with no enhanced status; a status that does not match the text; an unfamiliar format | **Review required.** No suppression is recorded on a guess. |
| Verified complaint or provider suppression notice | A provider notice or feedback report naming the address; **no Titan feedback loop is known** | Eligible, with separate reason `COMPLAINT_CONFIRMED` or `PROVIDER_SUPPRESSION_CONFIRMED`. Lifting requires the candidate's own request through a verifiable channel. |
| Local syntax refusal before any provider contact | r9 `INVALID_RECIPIENT` from `isDeliverableAddress` (syntax only) | **Not eligible** — no provider exposure. The record already shows it. |

**Note on the current r9 code:** today, any `RCPT TO` 5xx that is not 5.7.x is classified `INVALID_RECIPIENT`. That is broader than "confirmed invalid" (it includes, for example, 5.2.2 mailbox full). The r9 classification is **not** changed for retry purposes. Suppression eligibility uses the **enhanced status** instead. That status is already produced as a value-free diagnostic token and would now also be stored (§3.3).

## 3. Minimum footprint

One small private register, a send-path lookup and one operator command. It uses existing infrastructure only: MongoDB, the Mongoose models, the `ops:notifications:*` command pattern and the existing configuration validation. **No** webhook service, public admin interface, new email provider, paid validator, automated bounce parsing or raw-bounce archive.

### 3.1 Register — collection `recipient_suppressions` (a Doc 10 addition)

```
{
  _id,
  lookup:       { keyId: "k2026a", digest: "<64 hex>" },      // keyed HMAC; no plaintext address (§4)
  scope:        "APPLICATION_ACKNOWLEDGEMENT",                 // the internal notification is never suppressed
  state:        "ACTIVE" | "LIFTED",
  reason:       "INVALID_RECIPIENT_CONFIRMED" | "COMPLAINT_CONFIRMED" | "PROVIDER_SUPPRESSION_CONFIRMED",
  basis:        { kind: "RELAY_REFUSAL" | "ASYNC_BOUNCE" | "COMPLAINT" | "PROVIDER_NOTICE",
                  statusCode: "5.1.1" | null, evidenceRef: "BNC-2026-11-02-01" },
  sources:      [ { applicationId, attempt, messageToken } ],  // bounded: at most 10
  duplicateReports: 0,
  history:      [ { at, action: "ADD" | "DUPLICATE" | "LIFT" | "REAPPLY" | "REKEY" | "FORGET_SOURCE"
                          | "RELEASE_UNRECOVERABLE",
                    actor, reason, evidenceRef, decisionRef, requestId } ],  // bounded: at most 20
  version, createdAt, updatedAt
}
```

| Index | Purpose |
| --- | --- |
| Unique `{ "lookup.keyId": 1, "lookup.digest": 1, scope: 1 }` | One document per address and scope; a re-suppression after a lift reuses it (`REAPPLY`) |
| `{ state: 1, updatedAt: -1 }` | Listing |
| `{ "sources.applicationId": 1 }` | Deletion coordination and re-keying |
| `{ state: 1, scope: 1, "lookup.keyId": 1 }` | The key-coverage check (§4.4) and per-key counts |

**Field rules:**

- There is no address, name, DSN text, provider reply text or subject anywhere in the register.
- `messageToken` is the r9 Message-ID token (32 hex characters, derived from the event and Application id). It is pseudonymous, not an address.
- `actor` is an operator identifier token (§3.4), never an email address.
- `evidenceRef` follows the R3 pattern: 1–80 characters from `[A-Za-z0-9._:/#-]`, with **no `@`**.
- `decisionRef` is set only on `RELEASE_UNRECOVERABLE` (§4.4): an owner-decision identifier matching `^OD-\d{4}-\d{2}-\d{2}-\d{2}$`.
- At the history cap, further actions are **refused** rather than dropping entries. Duplicate reports only increment `duplicateReports` once the cap is near.

### 3.2 Send-path lookup (acknowledgement channel only)

In `createApplicationNotifier().attempt()` the r9 claim stays exactly as it is. For the `acknowledgement` channel only, **after the claim and before `notifications.deliver`**:

1. **Coverage check (§4.4).** One bounded, indexed read: is there any `ACTIVE` entry for this scope whose `lookup.keyId` is not a configured key (the current key or a verify-only previous key, §4.2)?
2. Compute the lookup digest from `candidate.emailNormalized` (§4) under **every configured key**: the current key and each verify-only previous key. There is no fixed maximum; during a rotation there is normally one previous key.
3. Run one bounded read on the primary (`maxTimeMS`, proposed 2 000 ms): an `ACTIVE` document with `scope: APPLICATION_ACKNOWLEDGEMENT` matching any of those `(keyId, digest)` pairs. Steps 1 and 3 may share one aggregation round trip; both stay inside the same time bound.
4. Then one of four things happens:
   - **Coverage incomplete, or the current key unavailable** → no SMTP. The outcome is `FAILED` / **`SUPPRESSION_COVERAGE_INCOMPLETE`** (class **CONFIGURATION**: never due on its own; only an operator run with `--include-configuration`, after coverage is restored, reaches it). This applies to **every** acknowledgement, suppressed or not, because an entry under a missing key could match any address. The log line is `suppression_coverage_incomplete`, with application id and channel only.
   - **Found** → no SMTP. The outcome is `FAILED` / **`RECIPIENT_SUPPRESSED`** (class **PERMANENT**: never due, and reached by no retry flag). The log line is `notification_suppressed`, with application id, channel and suppression `_id` only.
   - **Not found, coverage complete** → continue with the unchanged r9 delivery. (If the separate acknowledgement budget is adopted, its reservation comes here, before SMTP — [`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md). It is not part of this design.)
   - **Read failed or timed out** → no SMTP. The outcome is `FAILED` / **`SUPPRESSION_CHECK_UNAVAILABLE`** (class **TRANSIENT**: the normal bounded retry handles it later, with a fresh check). **The checks are never skipped**, so there is no blind send.
5. The outcome is recorded by the r9 conditional `recordNotificationOutcomes` (durable, `w: majority, j: true`).

**Unchanged:**

- The internal notification channel runs in parallel, untouched.
- Application acceptance never waits on the register beyond the existing bounded notification attempt; a register failure never turns `201` into an error.
- Replay with the same idempotency key returns the stored result and sends nothing (r9).

**Startup:** with `APPLICATION_ACKNOWLEDGEMENT_ENABLED=true` and no valid current key configured, configuration validation refuses to start in production. Elsewhere the acknowledgement fails as `SUPPRESSION_COVERAGE_INCOMPLETE` (CONFIGURATION). Configuration validation cannot see the register, so a missing **previous** key is caught at run time by step 1, and before acknowledgements are enabled by `coverage` (§4.4). The internal notification is unaffected.

### 3.3 Recording the enhanced status of a synchronous refusal

The adapter already derives a value-free enhanced status (for example `5.1.1`) for its diagnostic token. **Proposed:** store it on the channel as `lastStatusCode`, validated against `^[245]\.\d{1,3}\.\d{1,3}$` (a standard code, not provider text; Doc 10 §122). Only then can `add --from-refusal` check eligibility without reading logs.

### 3.4 Operator command — `npm run ops:notifications:suppression -- <subcommand>`

**Dry run by default.** `--apply` is required to write, and so is `--operator <id>`, which must be listed in `SUPPRESSION_OPERATOR_IDS`. The real access boundary is who can run commands against production (hosting access plus the database secret). In Phase 3 the same actions move behind an Admin permission (`notifications:suppression:manage`) with an AuditEvent (Doc 10 §§147–153).

| Subcommand | Input | Checks before any write | Effect |
| --- | --- | --- | --- |
| `list` | `[--state] [--limit ≤ 500]` | — | Prints id, state, reason, basis, source Application ids, counts and dates. **Never an address or digest.** |
| `check` | `--application <id>` | The Application exists | Prints `ACTIVE` / `LIFTED` / `NONE` for that Application's stored address |
| `add --from-refusal` | `--application <id> --evidence-ref <ref>` | Acknowledgement channel `FAILED` / `INVALID_RECIPIENT`; stored `lastStatusCode` is 5.1.1, 5.1.2, 5.1.3 or 5.1.10 | Upsert `ACTIVE`, basis `RELAY_REFUSAL`; history `ADD` (or `DUPLICATE` / `REAPPLY`) |
| `add --from-bounce` | `--message-token <32 hex> --status <x.y.z> --dsn-received <ISO time> --evidence-ref <ref> [--window-days ≤ 30]` | (1) **Bounded resolution:** recompute the acknowledgement token for Applications whose acknowledgement `lastAttemptAt` lies in the window before `--dsn-received` (at most 5 000), and require **exactly one** match. (2) That channel is `APPLICATION_ACKNOWLEDGEMENT` and was recorded `SENT` (relay accepted). (3) `--status` is eligible (§2). | Upsert `ACTIVE`, basis `ASYNC_BOUNCE`. The address comes from the matched Application's stored `emailNormalized`; **no address is ever typed in.** |
| `add --complaint` | `--application <id> --kind COMPLAINT\|PROVIDER_NOTICE --evidence-ref <ref>` | A verified notice exists (operator-attested) | Upsert with the separate reason |
| `lift` | `--suppression <id> --reason ADDRESS_CONFIRMED_VALID\|ENTERED_IN_ERROR --evidence-ref <ref>` | State `ACTIVE`; `version` matches | `LIFTED`; history `LIFT`. **Nothing is resent:** old `RECIPIENT_SUPPRESSED` channels stay as recorded and permanent. |
| `forget` | `--application <id> --reason PRIVACY_REQUEST\|RETENTION --evidence-ref <ref>` | — | Removes that source. When no source remains and the deletion is a privacy request, **deletes** the document (§4.3). |
| `coverage` | — | — | Read-only. For each key id: the number of `ACTIVE` entries, how many still have a source, whether the key is configured and, for a previous key, whether it is **safe to retire** (zero `ACTIVE` entries). Ends with `COVERAGE_COMPLETE` or `COVERAGE_INCOMPLETE`. Never prints an address or digest. |
| `rekey` | `[--limit ≤ 500]` | The current key is configured | §4.2: one conditional write per entry; resumable and idempotent; reports entries moved, already current, without a source, with a digest mismatch, and in conflict |
| `resolve-unrecoverable` | `--key-id <id> --expected-count <n> --confirm-key-unavailable --decision-ref <OD-…> --evidence-ref <ref>` | The key id is **not** configured; every selected entry is `ACTIVE` under it and has **no** remaining source; their number equals `--expected-count` | Each entry → `LIFTED`; history `RELEASE_UNRECOVERABLE` with the decision reference. **Nothing is resent.** §4.4 |

**Refusals.** Each of these exits with a fixed code and writes nothing:

- no match, more than one match, or a match on the **internal** channel (that is an incident: the configured recruitment recipient bounced);
- a channel not recorded `SENT` (conflicting evidence);
- an ineligible or missing status;
- an evidence reference that is invalid or contains `@`;
- an unknown operator;
- a cap reached;
- for `resolve-unrecoverable`: a key that is configured, an entry that still has a source, a count that differs from `--expected-count`, or a missing or invalid decision reference.

**Writes:**

- every write is conditional (`version`), single-document and durable (`w: majority, j: true`);
- a unique-index collision on upsert is re-read and handled as `DUPLICATE`;
- an add for an address that is already `ACTIVE` with the same source is a **no-op** (`ALREADY_ACTIVE`);
- with a new source, it appends the source (bounded) and counts a duplicate report.

### 3.5 Race boundaries

- A suppression applies to every lookup that **starts after** its add is acknowledged (`w: majority`, read from the primary).
- An acknowledgement whose lookup completed before that point may still be submitted. **An already-submitted message cannot be recalled.**
- Two adds for the same address converge on one document (unique index plus conditional writes).
- A lift and a send racing: the send uses whatever state its lookup read; a lift never triggers a send.

## 4. Privacy and storage

### 4.1 Choice — a keyed HMAC, not a plaintext copy and not a plain hash

**The digest:**

- `digest = HMAC-SHA-256(key, "valida-suppression-v1\0" + emailNormalized)`;
- `emailNormalized` is exactly Doc 10 §84: **trim + lowercase only**;
- no provider-specific rewriting (no dot or `+tag` stripping, and no Unicode folding beyond what Doc 10 already applies), so distinct addresses are never merged.

**Why a keyed HMAC:**

- the register only needs equality, and Doc 13 §178 (minimisation) argues against a second plaintext copy of candidate addresses that may outlive their Applications;
- a plain unsalted hash is **not** anonymisation: email addresses are guessable, so it would be reversible by dictionary;
- the keyed digest is still personal data (pseudonymous) and is handled as such.

**Alternative (owner choice):** store `emailNormalized` in plaintext in the same restricted database. That is simpler (no key, no rekeying), with the same access controls as Applications, but it keeps a plaintext copy. If chosen, the rules about logs, listing output and deletion stay the same.

### 4.2 Key management

| Topic | Rule |
| --- | --- |
| Key | `SUPPRESSION_HMAC_KEY`: at least 32 random bytes (base64), generated by the operator with a CSPRNG directly into the host's secret store. Never in Git, chat, logs, screenshots or a ZIP (Doc 13 §§112–117). Separate per environment; development and test use synthetic keys. A protected second copy of each production key is kept outside the host, so that a lost host secret can be restored (location **AWAITING INPUT** — owner decision). Claude never sees a key. |
| Identifier | `SUPPRESSION_HMAC_KEY_ID` (a short, non-secret token stored with each digest) |
| Rotation | Configure the new key as current and keep **every previous key that still has `ACTIVE` entries** as verify-only (`SUPPRESSION_HMAC_PREVIOUS_KEYS`, pairs of key id and key). Lookups check every configured key (§3.2). `rekey --apply` moves each `ACTIVE` entry to the current key, recomputing the digest from a **still-existing** source Application's stored address. While the old key is available, it first confirms that this address gives the stored digest under the old key; on a mismatch the entry is left unchanged and reported. Each entry moves in **one conditional write**, so an interrupted run leaves every entry wholly under the old or the new key — both still matched — and a re-run continues, skipping entries already under the current key. A unique-index conflict (the address is already registered under the current key) leaves the entry under the old key and is reported. Entries with **no remaining source** stay `ACTIVE` under the old key, which therefore stays configured. **Rotation never lifts an entry.** |
| Retirement | A previous key is removed from configuration only when `coverage` shows **zero** `ACTIVE` entries under it. If it is removed earlier, or goes missing, the coverage check fails closed: every candidate acknowledgement is blocked as `SUPPRESSION_COVERAGE_INCOMPLETE` until the key is restored or the affected entries are resolved (§4.4). Nothing is lifted. |
| Loss | A lost key means the entries under it can no longer be matched, so acknowledgements are **blocked** (§4.4), never resumed blindly. Recovery, in order: (1) restore the key from its protected copy; (2) otherwise, configure a new current key and `rekey` every entry that still has a source — the address comes from the stored Application, so the old key is not needed, but the confirming comparison is skipped and the history entry records that (`REKEY`, reason `SOURCE_UNVERIFIED`); (3) entries with neither a key nor a source are **unrecoverable** and are released only by the audited resolution of §4.4. |
| Compromise | Rotate immediately. Until rotation, someone holding both the key and the register could confirm guessed addresses. |

### 4.3 Retention and deletion

- **Retention** follows the recruitment retention period, which is **AWAITING** (Doc 13 §187). There is no automatic deletion now; a TTL is added only after a retention decision.
- **Entries without a source:** when a source is removed for retention, the entry stays `ACTIVE` without one. It cannot be re-keyed, so its key stays configured (§4.2).
- **Privacy request:** `forget` removes the source and, when nothing remains, deletes the entry. This also re-enables acknowledgements to that address. The register joins the coordinated deletion workflow (Doc 13 §190) and the provider / data inventory (Doc 13 §§197–198).
- **Logs** never contain an address or digest: only the Application id, channel, fixed codes, suppression `_id` and request id (Doc 13 §§118–121).

### 4.4 Coverage, activation and unrecoverable entries (rev 5)

**Invariant.** Every `ACTIVE` entry's `lookup.keyId` is a configured key — the current key or a verify-only previous key. While this holds, coverage is **complete**: every registered address can be matched. This checks key **identifiers** only; correct key **material** is the OPEN requirement of §4.5.

**Where it is checked:**

- on every acknowledgement attempt (§3.2, step 1), failing closed;
- by `coverage` (read-only), and at the start and end of every `rekey` run;
- in the `ops:notifications:retry` dry-run summary (one coverage line).

**What happens — nothing here ever lifts an entry:**

| Situation | Effect |
| --- | --- |
| A previous key removed while it still has `ACTIVE` entries (premature retirement) | Coverage incomplete: every acknowledgement is `SUPPRESSION_COVERAGE_INCOMPLETE`; no entry changes |
| A key lost, or not configured after a restart, a redeployment or a database restore | The same |
| A `rekey` run interrupted part-way | No effect while both keys stay configured (§4.2); the run is repeated |
| The register cannot be read | `SUPPRESSION_CHECK_UNAVAILABLE` (§3.2) |

**Activation and resumption.** Candidate acknowledgements are enabled for the first time, or re-enabled after a pause, only after `coverage` reports `COVERAGE_COMPLETE` against the production database with the configuration that will run. The result is recorded in the bounce log. If coverage cannot be established — the register cannot be read, or a key is missing — acknowledgements stay disabled. Enabling them remains a separately authorised operational action. If they are enabled without this step, the per-attempt check still sends nothing while coverage is incomplete.

**Not affected:** Application acceptance (`201`), the internal notification and replay. A coverage gap is a configuration incident, reported in the logs and the dry run; it does not make the service unready.

**Unrecoverable entries** are `ACTIVE` entries whose key is unavailable and which have no remaining source. No timer, key change or `rekey` lifts them. They are released only when all of these hold:

1. an owner decision record (`OD-…`) names the key id and the number of entries, states why the key cannot be restored, and accepts that the affected addresses — which Valida can no longer identify — may be acknowledged again if they apply again;
2. an authorised operator runs `resolve-unrecoverable` with `--apply`, `--confirm-key-unavailable`, the decision reference, an evidence reference and the expected count; the command refuses if the key is configured, if any selected entry still has a source, or if the count differs;
3. each entry is changed by one conditional write: `LIFTED`, with a `RELEASE_UNRECOVERABLE` history entry (actor, decision reference, evidence reference, request id). The entry is kept, so its history survives.

**Nothing is resent.** Earlier `RECIPIENT_SUPPRESSED` channels stay as recorded. Channels blocked as `SUPPRESSION_COVERAGE_INCOMPLETE` are retried only by a separate operator decision (`--include-configuration`).

**Prevention.** The protected second copy of each key (§4.2) keeps loss unlikely. Without it, a key loss always ends in this resolution path for every entry without a source.

### 4.5 Key-material integrity — OPEN requirement (rev 6; B7)

**The gap.** §4.4 checks key **identifiers**. A matching key id does not prove that the configured key **bytes** are the ones the `ACTIVE` entries were written with. Wrong bytes under the right id — after a restart, after a restore of the database or of the secret store, or during a rotation — would make every lookup miss. Suppressed addresses would then silently become eligible again, while the coverage check still reported complete.

**Requirement** (OD-2026-10-26-02, §4): before B7 implementation approval, the design must define an **integrity verification** of each configured key's material, and tests for a correct key id with incorrect key bytes at **restart**, after a **restore** and during **rotation** (SUP-22). **No acknowledgement may proceed while suppression coverage is unverified**, whether the doubt concerns the key ids or the key material.

**Status (rev 7):** the design below is **PROPOSED** for owner approval, and SUP-22 is specified (§8). Nothing of it is implemented. Until it is approved, implemented and its tests pass, precondition 5 of the implementation plan (Part B.1) is not met and G-SUP stays closed.

#### 4.5.1 Proposed design — one key check value per key id

| Topic | Rule |
| --- | --- |
| Check value | `check = HMAC-SHA-256(key, "valida-suppression-keycheck-v1\0" + keyId)`. It is a different domain from the address digest (§4.1), so it can never equal an entry digest. HMAC is a pseudorandom function: the value reveals nothing usable about the key or any address. It is still kept only in the restricted database and never logged. |
| Where it is kept | A small collection `recipient_suppression_keys` (a Doc 10 addition): `{ _id: keyId, check, state: "ACTIVE" \| "RETIRED", createdAt, createdBy, requestId }`. It lives in the **same database as the register**, so a database restore brings back the check values together with the entries they protect. |
| How it is written | Only by the operator command `key-register --apply` (an authorised operator identifier, §3.4), as a conditional insert on `_id`. An existing check value is **never overwritten**: a mismatch cannot be "repaired" by registering again. `add` refuses while the current key has no check value. |
| Where it is verified | (1) on **every** acknowledgement attempt, inside the §3.2 step 1 coverage read — the check values are read in the same bounded round trip, so there is no cache that a restart or a restore could leave stale; (2) by `coverage`; (3) at the start and end of every `rekey`. Comparison uses a constant-time equality on equal-length buffers. |
| Fail closed | For **every configured key** (current and verify-only previous): a missing check value, or one that does not match the configured bytes, makes coverage **incomplete**. The outcome is the existing `FAILED` / `SUPPRESSION_COVERAGE_INCOMPLETE` (class CONFIGURATION): no SMTP for any acknowledgement, no entry lifted, no history written. The log line carries the key id and a fixed reason (`KEY_CHECK_MISSING` or `KEY_MATERIAL_MISMATCH`) only. `coverage` reports the same per key id, and `rekey` refuses to start or stops. |
| Not affected | Application acceptance (`201`), the internal notification and replay, as in §4.4. Readiness is unchanged: a key-material fault is a configuration incident, not an outage. |
| Recovery | Restore the correct key bytes (from the protected copy, §4.2) — coverage becomes complete again on the next attempt. Otherwise the §4.2 loss path and, for entries without a source, the §4.4 audited resolution. There is no override flag. |

**What this does not cover.** It proves that the configured bytes are the bytes that were registered under that id. It cannot detect a wrong key that was registered under a **new** id from the start; that is prevented by the activation rule of §4.4 (`coverage` complete against production before enabling) and by SUP-22e.

**Decisions this design needs (owner):** approve the key-check design and the `recipient_suppression_keys` collection; approve the `key-register` subcommand. These join the open Part B.1 items (storage choice, key lifecycle, operator identifiers, the protected key-copy location).

## 5. Configuration and operational dependencies

| Item | Value |
| --- | --- |
| New variables | `SUPPRESSION_HMAC_KEY` (secret), `SUPPRESSION_HMAC_KEY_ID`, `SUPPRESSION_HMAC_PREVIOUS_KEYS` (secret; verify-only keys with their ids — required for every key that still has `ACTIVE` entries, §4.2), `SUPPRESSION_OPERATOR_IDS`, `SUPPRESSION_LOOKUP_TIMEOUT_MS` (default 2 000). The acknowledgement budget's variables belong to its separate proposal. |
| New codes and fields (Doc 10) | `RECIPIENT_SUPPRESSED` (PERMANENT), `SUPPRESSION_CHECK_UNAVAILABLE` (TRANSIENT), `SUPPRESSION_COVERAGE_INCOMPLETE` (CONFIGURATION — operator-only retry); the channel field `lastStatusCode`; the history action `RELEASE_UNRECOVERABLE` and the history field `decisionRef` |
| Readiness | The register shares the MongoDB connection; no new readiness dependency |
| Operations | The daily bounce review (Persian procedure) is the input for `add --from-bounce`. The `ops:notifications:retry` dry-run summary gains counts of `RECIPIENT_SUPPRESSED`, `SUPPRESSION_CHECK_UNAVAILABLE`, `SUPPRESSION_COVERAGE_INCOMPLETE` and eligible-but-unregistered refusals, and one coverage line (§4.4). The location of the protected key copy is **AWAITING INPUT**. |

## 6. SUP-1 precision amendment (APPROVED — OD-2026-11-02-03, with DEV-B6-04)

> **SUP-1 (amended).** After a **confirmed recipient-specific permanent invalid-address refusal** of an acknowledgement to address X — the relay's `RCPT TO` refusal with enhanced status 5.1.1, 5.1.2, 5.1.3 or 5.1.10, registered by the operator — a new, distinct Application with X returns `201`. Its acknowledgement is recorded `FAILED` / `RECIPIENT_SUPPRESSED` with **zero** SMTP submissions, and the internal notification is still sent.

**Why.** The rev 1 text said "permanent relay refusal". r9 treats many different `RCPT TO` refusals as permanent: a full mailbox, some policy refusals and unlabelled 5xx replies. Suppressing on all of them would block legitimate candidates whose address is valid but temporarily unable to receive, or whose refusal came from Valida's own sending reputation or policy. The amended wording suppresses only what is known to be a bad address.

## 7. Provider limits and abuse — what remains

### 7.1 Facts and exposure

- **Titan guidance** (read 2026-10-26; **not** a verified contract for the owner's Bluehost plan): bounce limits to other domains are, per mailbox, 5 per hour, 10 per day and 20 per 3 days; per domain, 10 per hour, 20 per day and 25 (Free) or 50 (Paid) per 3 days. To the same domain: per mailbox 50 per hour and 100 per day; no domain rate limit. The page does not say whether its windows are rolling or calendar-based, or whether a bounce counts when it arrives or when the original was sent (re-read for rev 5).
  - Exceeding a mailbox limit stops sending from that mailbox for the hour or the day.
  - A persistently high bounce count can block a mailbox or domain permanently.
  - [Titan — Email Bounce Back](https://support.titan.email/hc/en-us/articles/900001359746-Email-Bounce-Back)
- **Current controls (read in the code at `ec15048`):**
  - the Apply route allows 10 attempts per 15 minutes per client IP (`APPLICATION_RATE_LIMIT_*`; in-memory store, so per process and reset on restart; IPv6 grouped by /56);
  - acknowledgements are **disabled by default** (`APPLICATION_ACKNOWLEDGEMENT_ENABLED=false`);
  - **there is no global acknowledgement budget.**
- **Worst case with acknowledgements enabled:**
  - one client IP could cause up to about 40 acknowledgements an hour to addresses of its choosing;
  - a handful of invalid ones exceeds the 5-per-hour mailbox limit, which stops sending from `notifications@` — **including internal notifications**;
  - at the domain level, the limit is shared by every mailbox, so human mail could be affected (per the guidance);
  - suppression does not help here, because the addresses are new.
- **Daily manual monitoring cannot prevent an hourly restriction.** It only shortens how long a problem goes unnoticed.

### 7.2 Smallest controls

| # | Control | Size | Recommendation |
| --- | --- | --- | --- |
| 1 | **Operator pause:** set `APPLICATION_ACKNOWLEDGEMENT_ENABLED=false` and restart (existing switch). Applications and internal notifications continue. | None (documented action) | **Yes** — the escalation action in the bounce procedure. Executing it is a future operational action, **not authorised** here. |
| 2 | **Acknowledgement budget** — moved in rev 5 to its own proposal, [`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md) (decision D2b). It is separate from suppression and from G-SUP, and it reduces the risk without guaranteeing that Titan's limits are never reached. | See that proposal | **PROPOSED; owner choice.** No caps are selected. |
| 3 | DNS / MX pre-check of the recipient domain; CAPTCHA; double opt-in; a paid validator; webhook ingestion | — | **Not proposed** now (new dependencies, false negatives, or scope beyond "minimal"). They can be revisited with evidence. |

**G-SUP remains closed.** The suppression mechanism is the approved route; the budget (D2b) is a separate owner choice and is not a G-SUP criterion. Neither is an exception.

## 8. Acceptance tests — PROPOSED / NOT WRITTEN / NOT RUN

Environment: a real MongoDB replica set; a local SMTP test server with a submission counter; synthetic data and synthetic keys only; nothing live.

**Traceability for SUP-1…6:**

| Test | Behaviour proven | Design element |
| --- | --- | --- |
| **SUP-1** | After a confirmed recipient-specific refusal (5.1.1 at `RCPT TO`), registered with `add --from-refusal`, a distinct Application for the same address returns `201`. Its acknowledgement is `FAILED` / `RECIPIENT_SUPPRESSED` with **zero** SMTP submissions. The internal notification is sent. | §2, §3.2–3.4, §6 |
| **SUP-2** | The same outcome after `add --from-bounce` with a correlated DSN token, an eligible status and a matching `SENT` acknowledgement | §3.4 |
| **SUP-3** | 4.x.x, mailbox-full (5.2.2), `TIMEOUT`, `OUTCOME_UNKNOWN` and a stale attempt are **refused** by `add` and never suppress | §2 |
| **SUP-4** | Suppression never affects Application acceptance, the internal notification, replay or idempotency (the same key returns the stored result; zero extra sends) | §3.2 |
| **SUP-5** | `lift` requires an authorised operator, a reason and evidence. History is kept. **No resend:** every retry flag leaves `RECIPIENT_SUPPRESSED` channels untouched; a later new Application is acknowledged normally. | §3.4 |
| **SUP-6** | No plaintext address or digest in logs (the existing log scans, extended). The register holds no plaintext address. Deletion and retention handling: `forget` removes the source or entry; the entry is listed in the inventory. | §4 |

**Focused cases:**

| # | Case |
| --- | --- |
| SUP-7 | Sender-side failures do not suppress the recipient: 5.7.x at `RCPT TO`, `MAIL FROM` refusal, authentication failure, quota or rate refusals. `add` refuses them, and they are reported as incidents. |
| SUP-8 | Duplicate reports are idempotent: the same source → `ALREADY_ACTIVE` with no write; a new source → one appended source and `duplicateReports + 1`; concurrent duplicates → one document. |
| SUP-9 | Uncorrelated or conflicting evidence cannot suppress: no match; more than one match; a match on the internal channel; a channel not `SENT`; a missing or ineligible status; an out-of-window time. Each case writes nothing. |
| SUP-10 | Normalisation merges only case and surrounding whitespace. `a.b@x` / `ab@x` and `a+t@x` / `a@x` stay distinct, and non-ASCII local parts are not altered. |
| SUP-11 | Register read failure or timeout, or a missing key → no SMTP; `SUPPRESSION_CHECK_UNAVAILABLE`; the Application still returns `201`; the internal notification is unaffected. A later retry with the register available behaves correctly. A failed `add` leaves no partial document. |
| SUP-12 | Concurrency: a lookup that starts after a committed add is suppressed. A send whose lookup completed earlier is submitted once and is **not** recalled. The submission count is asserted exactly. |
| SUP-13 | Unauthorised actions are rejected: unknown operator; missing `--apply` (dry run, no write); invalid evidence reference or one containing `@`; history cap reached |
| SUP-14 | Durable restart and audit integrity: a kill between the read and the conditional write → no change or a complete change, never partial. `version` conflicts are retried safely. History entries are never rewritten. |
| SUP-15 | Repeated known-invalid submissions: N new Applications with a suppressed address → **zero** additional acknowledgements (SMTP counter 0), N `201`s and N internal notifications |
| SUP-16 | **(revised, rev 5)** Rotation without loss of coverage: with the new key current and the old key verify-only, an address registered under the old key is still suppressed (zero submissions). `rekey` moves every entry that has a source; a second run changes nothing. Entries without a source stay `ACTIVE` under the old key and are still matched. `coverage` reports the old key as **not** safe to retire while any such entry remains. No entry is lifted by rotation. |
| SUP-17 | **Withdrawn in rev 5.** The acknowledgement budget is a separate proposal; its tests are BUD-1…BUD-10 in [`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md). |
| SUP-18 | **Missing historical key.** Remove a verify-only key from the configuration while `ACTIVE` entries remain under it; separately, replace a "lost" current key with a new one. A new Application for a suppressed address **and** one for an unsuppressed address: each returns `201`, the internal notification is sent, and the acknowledgement is `FAILED` / `SUPPRESSION_COVERAGE_INCOMPLETE` with zero submissions. No register entry changes state and no history entry is added. With the key restored, the next Application behaves normally; the blocked channels are selected by no retry flag except `--include-configuration`. |
| SUP-19 | **Incomplete migration.** Interrupt `rekey` (fault injection or a killed process) after *k* of *n* entries: each entry is wholly under the old or the new key; with both keys configured, addresses in both groups are suppressed and `coverage` is complete; a second run finishes the remaining entries and a third changes nothing. A digest-mismatch entry and a unique-index conflict are reported, stay under the old key, and keep it required. |
| SUP-20 | **Premature key retirement.** `coverage` reports a key with `ACTIVE` entries as not safe to retire. Removing it anyway gives the SUP-18 behaviour at the next attempt; no entry is lifted, no history is written, and `resolve-unrecoverable` refuses entries that still have a source. |
| SUP-21 | **Audited resolution of unrecoverable entries.** `resolve-unrecoverable` refuses without `--apply`, an authorised operator, `--confirm-key-unavailable`, a valid decision reference, a valid evidence reference or a matching expected count, and refuses while the key is configured. On success, exactly the expected entries become `LIFTED`, each with one `RELEASE_UNRECOVERABLE` history entry; there are zero submissions; coverage becomes complete and the next Application is acknowledged normally; earlier channels are unchanged. |
| SUP-22 | **Key-material integrity (rev 7, specified with §4.5; PROPOSED).** Synthetic keys only. Each case asserts: zero SMTP submissions for every acknowledgement, the internal notification still sent, no entry lifted, no history written, the outcome `FAILED` / `SUPPRESSION_COVERAGE_INCOMPLETE`, and log lines with the key id and fixed reason only (no key, check value, digest or address). **22a restart:** entries and the check value written under id `k1` with bytes K1; the process restarts with id `k1` and bytes K1′ → blocked; `coverage` reports `KEY_MATERIAL_MISMATCH k1`. **22b restore:** a database restored from a snapshot taken under key generation 1 while the secret store holds generation 2 under the same id → blocked; with the matching bytes restored → coverage complete and a suppressed address matched again. **22c rotation:** current `k2` correct, verify-only `k1` with wrong bytes → blocked; `rekey` refuses to start; with correct `k1` bytes the rekey runs and ends with coverage complete. **22d missing check:** a configured key with `ACTIVE` entries but no check value → blocked (`KEY_CHECK_MISSING`); `key-register` for an id that already has a check value refuses and changes nothing; `add` refuses while the current key has no check value. **22e correct material:** all checks match → coverage complete; a suppressed address is matched under every configured key; a non-suppressed address proceeds to the unchanged r9 delivery. **22f comparison and output:** the comparison is constant-time on equal lengths; a check value of the wrong length is a mismatch, never an exception; no command or log prints a key or check value. |

**Live verification** (separately authorised later): one real asynchronous Titan DSN processed end to end by the operator command against a non-production database. **Not authorised now.**
