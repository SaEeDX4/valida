# Minimal recipient suppression for candidate acknowledgements — design (D2a)

| | |
| --- | --- |
| Decision | D2a: **APPROACH APPROVED — DESIGN / IMPLEMENTATION / VERIFICATION PENDING** (OD-2026-10-26-01). This is **not** a suppression exception, and it does not open gate G-SUP. |
| Status of this document | **APPROVED — OD-2026-11-04-02** (S1 keyed HMAC; S2–S6). **Implemented in B7** on `b7-work`: register, send-path checks, operator command, key integrity, verified rotation and controlled recovery. SUP-1…16 and SUP-18…23 are **written and run** (see `docs/review/B7_REVIEW_PACKAGE.md`). The production start-up refusal of acknowledgements (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`) **stays**. G-SUP stays closed until this evidence is reviewed and accepted. |
| Milestone | A bounded **B7** change, after B6 acceptance and separate B7 authorisation (Stage 4). Not bundled with the template revision (Stage 2), R3, the message-copy work or the body-discard fix. |
| Governing text | Doc 14 §§117–121, 167; MAIL-042, MAIL-043, MAIL-044; Doc 09 §§128–136; Doc 10 §§84–85, 117–122, 139, 141; Doc 13 §§118–121, 177–178, 186–187, 190; decision package DEV-B6-04 (SUP-1…6, G-SUP) |
| Gate | **G-SUP stays closed** until this design (or an approved revision) is implemented and SUP-1…6, plus the focused cases of §8, pass with execution evidence. No exception is approved. |
| Revision | **rev 5** (2026-10-26, after GPT's review of rev 4). The key lifecycle is now **fail-closed**: retiring, losing or failing to migrate a key never lifts a suppression; acknowledgements are blocked while coverage is incomplete; unrecoverable entries need an explicit, audited owner decision (§1, §3.1, §3.2, §3.4, §4.2, §4.3, new §4.4, §5). The acknowledgement budget moved to a separate proposal ([`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md), decision D2b) (§5, §7.2). §8: SUP-16 revised, SUP-17 withdrawn, SUP-18…21 added. Nothing else changed. |
| Revision | **rev 6** (2026-10-26, OD-2026-10-26-02): new §4.5 registers an **OPEN** key-material integrity requirement, with SUP-22 to be specified; a note in §4.4; the escalation wording in §2. This is an open design and test requirement — not an implemented safeguard, and not an approval of this design. |
| Revision | **rev 7** (2026-11-04, B7, OD-2026-11-04-01): §4.5 now holds a **PROPOSED** key-material integrity design (key check values) and SUP-22 is **specified** (SUP-22a–f), for owner approval; §6 records that the SUP-1 amendment was **APPROVED** with DEV-B6-04 (OD-2026-11-02-03). Production start-up already refuses `APPLICATION_ACKNOWLEDGEMENT_ENABLED=true` (B7, rule `ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`), the minimal form of the §3.2 start-up refusal. Nothing else in this design is implemented, and no design detail is approved by this revision. |
| Revision | **rev 8** (2026-11-04, after GPT's focused B7 review): (1) `key-register` can never establish trust for a key id that already has register entries or a key document, so a missing check value cannot be replaced (§4.5.1; SUP-22g); (2) ordinary rotation (`rekey`, verified keys only) is separated from **controlled recovery** of a lost or untrusted key (`recover-key`, owner decision, acknowledgements blocked until it completes; §3.1, §3.4, §4.2, §4.5.1; SUP-23a–f); (3) SUP-11's missing-key outcome corrected to `SUPPRESSION_COVERAGE_INCOMPLETE`. Still **PROPOSED**; nothing is implemented. |
| Revision | **rev 8.1** (2026-11-04, OD-2026-11-04-02): approved; the SUP-21 correction recorded in §8; §8 tests written and run in B7. The design text is otherwise unchanged. |
| Revision | **rev 8.2** (2026-11-04, after GPT's B7 r2 review): **review corrections — PROPOSED for GPT review and owner confirmation; implemented on `b7-work` for that review.** The approved text is kept; each change is in **§9** and marked *(rev 8.2, §9.n)* where it applies: (1) a consistent authorisation view under key migration — lookup aliases with a quiet period (§9.1); (2) bounded, resumable `rekey` / `recover-key` passes (§9.2); (3) no fixed maximum on verify-only keys, as §3.2 already says — the implementation's cap of 8 removed (§9.3); (4) the minimal data-inventory entry for SUP-6 (§9.4); (5) the history cap on the duplicate-report path (§9.5); tests SUP-24, SUP-25 and SUP-13b (§8). Production acknowledgements stay refused. |
| Revision | **rev 8.3** (2026-11-04, after GPT's B7 r3 review): **clock-free authorisation — PROPOSED for GPT review and owner confirmation; implemented on `b7-work` for that review.** The rev 8.2 quiet period (§9.1) made a send decision depend on operator clocks and on when a delayed move became visible; it is **withdrawn** and replaced by the prune sequence of **§9.6**. The rev 8.2 text of §9.1 is kept as the record and marked where it is superseded. Tests SUP-24 (now through the real send-path read) and SUP-24b (§8). Production acknowledgements stay refused. |

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
  lookups:      [ { keyId, digest, retiredAt } ],               // rev 8.2 (§9.1): the primary (retiredAt null, = lookup) and aliases; 1..8
                                                                // rev 8.3 (§9.6): retiredAt is informational only
  pruneSeq:     0,                                              // rev 8.3 (§9.6): the stamp of the last alias prune; never decreases
  scope:        "APPLICATION_ACKNOWLEDGEMENT",                 // the internal notification is never suppressed
  state:        "ACTIVE" | "LIFTED",
  reason:       "INVALID_RECIPIENT_CONFIRMED" | "COMPLAINT_CONFIRMED" | "PROVIDER_SUPPRESSION_CONFIRMED",
  basis:        { kind: "RELAY_REFUSAL" | "ASYNC_BOUNCE" | "COMPLAINT" | "PROVIDER_NOTICE",
                  statusCode: "5.1.1" | null, evidenceRef: "BNC-2026-11-02-01" },
  sources:      [ { applicationId, attempt, messageToken } ],  // bounded: at most 10
  duplicateReports: 0,
  history:      [ { at, action: "ADD" | "DUPLICATE" | "LIFT" | "REAPPLY" | "REKEY" | "FORGET_SOURCE"
                          | "RELEASE_UNRECOVERABLE",          // REKEY reason: ROTATION | SOURCE_UNVERIFIED (rev 8)
                    actor, reason, evidenceRef, decisionRef, requestId } ],  // bounded: at most 20
  version, createdAt, updatedAt
}
```

| Index | Purpose |
| --- | --- |
| Unique `{ "lookup.keyId": 1, "lookup.digest": 1, scope: 1 }` | One document per address and scope; a re-suppression after a lift reuses it (`REAPPLY`) |
| `{ state: 1, updatedAt: -1 }` | Listing |
| `{ "sources.applicationId": 1 }` | Deletion coordination and re-keying |
| `{ state: 1, scope: 1, "lookup.keyId": 1 }` | The key-coverage check (§4.4) and per-key counts. *(rev 8.2, §9.1: replaced by `{ state: 1, scope: 1, "lookups.keyId": 1 }`)* |
| *(rev 8.2, §9.1)* `{ "lookups.keyId": 1, "lookups.digest": 1 }` | The send-path match (§3.2 step 3), one index point lookup per configured key |
| *(rev 8.3, §9.6)* `{ pruneSeq: -1 }` | The highest prune stamp, read before and after the send-path reads (one index point read each) |

**Field rules:**

- There is no address, name, DSN text, provider reply text or subject anywhere in the register.
- `messageToken` is the r9 Message-ID token (32 hex characters, derived from the event and Application id). It is pseudonymous, not an address.
- `actor` is an operator identifier token (§3.4), never an email address.
- `evidenceRef` follows the R3 pattern: 1–80 characters from `[A-Za-z0-9._:/#-]`, with **no `@`**.
- `decisionRef` is set only on `RELEASE_UNRECOVERABLE` (§4.4) and on a `REKEY` written by controlled recovery (reason `SOURCE_UNVERIFIED`, §4.2): an owner-decision identifier matching `^OD-\d{4}-\d{2}-\d{2}-\d{2}$`.
- At the history cap, further actions are **refused** rather than dropping entries. Duplicate reports only increment `duplicateReports` once the cap is near. *(rev 8.2, §9.5: the duplicate-report and re-apply paths refuse at the cap, dry runs included; alias pruning records no action and is not refused.)*

### 3.2 Send-path lookup (acknowledgement channel only)

In `createApplicationNotifier().attempt()` the r9 claim stays exactly as it is. For the `acknowledgement` channel only, **after the claim and before `notifications.deliver`**:

1. **Coverage check (§4.4).** One bounded, indexed read: is there any `ACTIVE` entry for this scope whose `lookup.keyId` *(rev 8.2, §9.1: any key id in its `lookups`)* is not a configured key (the current key or a verify-only previous key, §4.2)? In the same round trip (rev 7–8): the key check of every configured key and any `RECOVERING` key document (§4.5.1).
2. Compute the lookup digest from `candidate.emailNormalized` (§4) under **every configured key**: the current key and each verify-only previous key. There is no fixed maximum; during a rotation there is normally one previous key. *(rev 8.2, §9.3: the implementation now imposes none; only the configuration value's length is bounded.)*
3. Run one bounded read on the primary (`maxTimeMS`, proposed 2 000 ms): an `ACTIVE` document with `scope: APPLICATION_ACKNOWLEDGEMENT` matching any of those `(keyId, digest)` pairs *(rev 8.2, §9.1: in its `lookups`)*. Steps 1 and 3 may share one aggregation round trip; both stay inside the same time bound. *(rev 8.3, §9.6: steps 1 and 3 are bracketed by a read of the highest prune stamp before and after, all inside the same time bound; `PROCEED` needs the two stamps to be equal.)*
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
| `lift` | `--suppression <id> --reason ADDRESS_CONFIRMED_VALID\|ENTERED_IN_ERROR\|SUPERSEDED --evidence-ref <ref>` | State `ACTIVE`; `version` matches. For `SUPERSEDED` (rev 8, controlled recovery only): the entry is under a key in state `RECOVERING`, and its source Application's address already has an **`ACTIVE`** entry under the current key, so the address stays suppressed | `LIFTED`; history `LIFT`. **Nothing is resent:** old `RECIPIENT_SUPPRESSED` channels stay as recorded and permanent. |
| `forget` | `--application <id> --reason PRIVACY_REQUEST\|RETENTION --evidence-ref <ref>` | — | Removes that source. When no source remains and the deletion is a privacy request, **deletes** the document (§4.3). |
| `coverage` | — | — | Read-only. For each key id: the number of `ACTIVE` entries, how many still have a source, whether the key is configured and, for a previous key, whether it is **safe to retire** (zero `ACTIVE` entries *(rev 8.2, §9.1: and zero aliases)*). Ends with `COVERAGE_COMPLETE` or `COVERAGE_INCOMPLETE`. Never prints an address or digest. |
| `rekey` | `[--limit ≤ 500]` *(rev 8.2, §9.2: `[--after <id>]`)* | **Ordinary, verified rotation only (rev 8).** Coverage is complete; the current key and every previous key are configured and pass the §4.5 key check; no key document is `RECOVERING`. Otherwise it refuses and writes nothing | §4.2: one conditional write per entry, each confirmed under its old key first (history `REKEY`, reason `ROTATION`); resumable and idempotent; reports entries moved, already current, without a source, with a digest mismatch, and in conflict. It never writes `SOURCE_UNVERIFIED` |
| `key-register` | `--key-id <id>` | The id is configured and is **not** `--key-id` of any register entry (any state) or any key document (any state) — a fresh id only (§4.5.1) | Conditional insert of the key's check value; never an overwrite |
| `recover-key` | `--key-id <id> --decision-ref <OD-…> --evidence-ref <ref> --confirm-key-unavailable [--expected-count <n>] [--limit ≤ 500] [--complete]` *(rev 8.2, §9.2: `[--after <id>]`)* | §4.2 "Controlled recovery": the id is **not** configured; the current key is a different id and passes the §4.5 key check; the decision reference is valid; first run: `--expected-count` equals the `ACTIVE` entries under the id; later runs: the same decision reference as recorded | First run marks the id `RECOVERING` (permanently untrusted). Moves each `ACTIVE` entry that has a source to the current key (history `REKEY`, reason `SOURCE_UNVERIFIED`, with the decision reference). `--complete` sets the id `RETIRED` only when no `ACTIVE` entry remains under it *(rev 8.2, §9.1: and no alias under it remains — `ALIASES_PENDING` otherwise; rev 8.3, §9.6: it prunes them at once, stamped, so `ALIASES_PENDING` now means aliases beyond `--limit` or in a write conflict)* |
| `resolve-unrecoverable` | `--key-id <id> --expected-count <n> --confirm-key-unavailable --decision-ref <OD-…> --evidence-ref <ref>` | The key id is **not** configured; every selected entry is `ACTIVE` under it and has **no** remaining source; their number equals `--expected-count` | Each entry → `LIFTED`; history `RELEASE_UNRECOVERABLE` with the decision reference. **Nothing is resent.** §4.4 |

**Refusals.** Each of these exits with a fixed code and writes nothing:

- no match, more than one match, or a match on the **internal** channel (that is an incident: the configured recruitment recipient bounced);
- a channel not recorded `SENT` (conflicting evidence);
- an ineligible or missing status;
- an evidence reference that is invalid or contains `@`;
- an unknown operator;
- a cap reached;
- for `resolve-unrecoverable`: a key that is configured, an entry that still has a source, a count that differs from `--expected-count`, or a missing or invalid decision reference;
- for `key-register` (rev 8): an id already used by any register entry or key document (`KEY_ID_ALREADY_USED`), or an id that is not configured;
- for `recover-key` (rev 8): the id still configured (`KEY_STILL_CONFIGURED`), a current key that is missing, unverified or the same id, a missing or invalid decision reference, a missing `--confirm-key-unavailable`, a first-run count that differs, a different decision reference on a later run, an id already `RETIRED`, or `--complete` while an `ACTIVE` entry remains under the id;
- for `rekey` (rev 8): incomplete coverage, an unverified configured key, or a `RECOVERING` key document.

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
| Rotation | Configure the new key as current and keep **every previous key that still has `ACTIVE` entries** as verify-only (`SUPPRESSION_HMAC_PREVIOUS_KEYS`, pairs of key id and key). Lookups check every configured key (§3.2). `rekey --apply` moves each `ACTIVE` entry to the current key, recomputing the digest from a **still-existing** source Application's stored address. While the old key is available, it first confirms that this address gives the stored digest under the old key; on a mismatch the entry is left unchanged and reported. Each entry moves in **one conditional write**, so an interrupted run leaves every entry wholly under the old or the new key — both still matched — and a re-run continues, skipping entries already under the current key. A unique-index conflict (the address is already registered under the current key) leaves the entry under the old key and is reported. Entries with **no remaining source** stay `ACTIVE` under the old key, which therefore stays configured. **Rotation never lifts an entry.** *(Rev 8.2, §9.1: a move keeps the old lookup as an alias for at least the quiet period.)* **Rev 8:** rotation needs every key to be present and verified (§4.5), so `rekey` runs only with complete coverage and always confirms the old digest. It never handles a lost or untrusted key; that is controlled recovery, below. |
| Retirement | A previous key is removed from configuration only when `coverage` shows **zero** `ACTIVE` entries under it *(rev 8.2, §9.1: and zero aliases — `safeToRetire`)*. If it is removed earlier, or goes missing, the coverage check fails closed: every candidate acknowledgement is blocked as `SUPPRESSION_COVERAGE_INCOMPLETE` until the key is restored or the affected entries are resolved (§4.4). Nothing is lifted. |
| Loss | **Rev 8.** A key is **lost** when its bytes are unavailable, and **untrusted** when its material cannot be verified (§4.5: its check value is missing, or it mismatches and the correct bytes are unavailable). Either way, the entries under it can no longer be matched safely, so acknowledgements are **blocked** (§4.4), never resumed blindly. Recovery, in order: (1) restore the correct bytes from the protected copy — this counts only when the id's check value exists and matches (§4.5); (2) otherwise **controlled recovery** (next row) — never the ordinary `rekey`, which refuses; (3) entries with neither a usable key nor a source are **unrecoverable** and are released only by the audited resolution of §4.4. |
| Controlled recovery (rev 8) | 1. **Owner decision** (`OD-…`): it names the key id, whether the key is lost or untrusted, and the number of `ACTIVE` entries under it. 2. **Configuration:** the lost or untrusted id is removed from the configuration, so its bytes are never used again. The current key must have a **different** id and pass the §4.5 key check; when the lost key was the current one, a **fresh** id is configured as current and registered (`key-register`). 3. **`recover-key --apply`:** the first run marks that id's key document `RECOVERING` — a conditional insert when no document exists, otherwise a conditional update — recording the decision reference, evidence reference, operator, time and starting count. From then on the id is never trusted again. Each `ACTIVE` entry under the id that still has a source moves to the current key in **one conditional, durable write** (`version`; `w: majority, j: true`). Its digest is recomputed from the source Application's stored `emailNormalized`; the comparison with the old digest is impossible and is recorded as skipped (history `REKEY`, reason `SOURCE_UNVERIFIED`, with actor, decision reference, evidence reference and request id). Runs are bounded, resumable and idempotent. 4. **Unresolved entries are preserved unchanged and reported, never deleted or rewritten:** entries without a source (released only by `resolve-unrecoverable`, §4.4); conflicts whose address is already `ACTIVE` under the current key (closed only by `lift --reason SUPERSEDED`, so the address stays suppressed); conflicts whose current-key document is `LIFTED` (`CONFLICT_LIFTED`: contradictory evidence, left to an explicit operator decision with evidence, `add` or `lift`). 5. **`recover-key --complete`** refuses while any `ACTIVE` entry remains under the id; otherwise it sets the key document `RETIRED` (conditional write) and prints the coverage result. **Throughout steps 2–5, every candidate acknowledgement is `FAILED` / `SUPPRESSION_COVERAGE_INCOMPLETE` with zero SMTP:** coverage is incomplete while an `ACTIVE` entry is under an unconfigured id **or** any key document is `RECOVERING` (§4.5.1). Sending resumes only after `--complete` and `COVERAGE_COMPLETE`, recorded in the bounce log as any resumption (§4.4). Nothing is lifted except by the explicit `lift` / `resolve-unrecoverable` commands, and nothing is resent. |
| Compromise | Rotate immediately. Until rotation, someone holding both the key and the register could confirm guessed addresses. |

### 4.3 Retention and deletion

- **Retention** follows the recruitment retention period, which is **AWAITING** (Doc 13 §187). There is no automatic deletion now; a TTL is added only after a retention decision.
- **Entries without a source:** when a source is removed for retention, the entry stays `ACTIVE` without one. It cannot be re-keyed, so its key stays configured (§4.2).
- **Privacy request:** `forget` removes the source and, when nothing remains, deletes the entry. This also re-enables acknowledgements to that address. The register joins the coordinated deletion workflow (Doc 13 §190) and the provider / data inventory (Doc 13 §§197–198).
- **Logs** never contain an address or digest: only the Application id, channel, fixed codes, suppression `_id` and request id (Doc 13 §§118–121).

### 4.4 Coverage, activation and unrecoverable entries (rev 5)

**Invariant.** Every `ACTIVE` entry's `lookup.keyId` *(rev 8.2, §9.1: every key id in its `lookups`)* is a configured key — the current key or a verify-only previous key. While this holds, coverage is **complete**: every registered address can be matched. This checks key **identifiers** only; correct key **material** is the OPEN requirement of §4.5.

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
| Where it is kept | A small collection `recipient_suppression_keys` (a Doc 10 addition): `{ _id: keyId, check, state: "ACTIVE" \| "RECOVERING" \| "RETIRED", recovery: null \| { decisionRef, evidenceRef, reason: "LOST" \| "UNTRUSTED", startedAt, startedBy, startCount, completedAt, completedBy }, createdAt, createdBy, requestId, version }`. `check` is `null` only on a document that `recover-key` created for an id that had none. `RECOVERING` and `RETIRED` are permanent: such an id is never trusted, registered or matched again. The collection lives in the **same database as the register**, so a database restore brings back the check values together with the entries they protect. |
| How it is written | Only by the operator command `key-register --apply` (an authorised operator identifier, §3.4), as a conditional insert on `_id`. An existing check value is **never overwritten**: a mismatch cannot be "repaired" by registering again. `add` refuses while the current key has no check value. **Rev 8 — fresh ids only:** `key-register` refuses (`KEY_ID_ALREADY_USED`, writing nothing) for any id that appears as `lookup.keyId` on **any** register entry, whatever its state, or that has **any** key document, whatever its state. Because `add` writes only under a registered current key, an id with entries but no check value can only result from deletion, tampering or a partial restore. Its configured bytes — right or wrong — can therefore never be made trusted. Such an id is recovered only by controlled recovery (§4.2), and acknowledgements stay blocked until that completes. |
| Where it is verified | (1) on **every** acknowledgement attempt, inside the §3.2 step 1 coverage read — the check values are read in the same bounded round trip, so there is no cache that a restart or a restore could leave stale; (2) by `coverage`; (3) at the start and end of every `rekey`. Comparison uses a constant-time equality on equal-length buffers. |
| Fail closed | For **every configured key** (current and verify-only previous): a missing check value, or one that does not match the configured bytes, makes coverage **incomplete**. So does a configured id whose key document is `RECOVERING` or `RETIRED` (`KEY_NOT_TRUSTED`), and so does **any** key document in state `RECOVERING`, even with no entries left under it (rev 8). The outcome is the existing `FAILED` / `SUPPRESSION_COVERAGE_INCOMPLETE` (class CONFIGURATION): no SMTP for any acknowledgement, no entry lifted, no history written. The log line carries the key id and a fixed reason (`KEY_CHECK_MISSING` or `KEY_MATERIAL_MISMATCH`) only. `coverage` reports the same per key id, and `rekey` refuses to start or stops; a lost or untrusted key is handled only by `recover-key` (§4.2). |
| Not affected | Application acceptance (`201`), the internal notification and replay, as in §4.4. Readiness is unchanged: a key-material fault is a configuration incident, not an outage. |
| Recovery | Restore the correct key bytes (from the protected copy, §4.2), which is possible only while the id's check value exists; coverage becomes complete again on the next attempt. Otherwise §4.2 controlled recovery and, for entries without a source, the §4.4 audited resolution. There is no override flag, and no path re-trusts an id with a missing check value. |

**What this does not cover.** It proves that the configured bytes are the bytes that were registered under that id. It cannot detect a wrong key that was registered under a **new** id from the start; that is prevented by the activation rule of §4.4 (`coverage` complete against production before enabling) and by SUP-22e.

**Decisions this design needs (owner):** consolidated in [`docs/review/B7_SUPPRESSION_DECISION_PROPOSAL.md`](../review/B7_SUPPRESSION_DECISION_PROPOSAL.md) (rev 8).

## 5. Configuration and operational dependencies

| Item | Value |
| --- | --- |
| New variables | `SUPPRESSION_HMAC_KEY` (secret), `SUPPRESSION_HMAC_KEY_ID`, `SUPPRESSION_HMAC_PREVIOUS_KEYS` (secret; verify-only keys with their ids — required for every key that still has `ACTIVE` entries, §4.2; *rev 8.2, §9.3: any number of keys, at most 32,767 characters in all*), `SUPPRESSION_OPERATOR_IDS`, `SUPPRESSION_LOOKUP_TIMEOUT_MS` (default 2 000). The acknowledgement budget's variables belong to its separate proposal. |
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

## 8. Acceptance tests — WRITTEN AND RUN IN B7 (results: `docs/review/B7_REVIEW_PACKAGE.md`)

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
| SUP-11 | **(corrected, rev 8)** Register read failure or timeout → no SMTP; `FAILED` / `SUPPRESSION_CHECK_UNAVAILABLE` (TRANSIENT); a later normal retry with the register available runs a fresh check and behaves correctly. **A missing key** — no current key configured, or a previous key with `ACTIVE` entries not configured → no SMTP; `FAILED` / **`SUPPRESSION_COVERAGE_INCOMPLETE`** (CONFIGURATION): never due on its own, and reached only by an operator run with `--include-configuration` after coverage is restored (§3.2, §4.4). In both cases the Application still returns `201` and the internal notification is unaffected. A failed `add` leaves no partial document. |
| SUP-12 | Concurrency: a lookup that starts after a committed add is suppressed. A send whose lookup completed earlier is submitted once and is **not** recalled. The submission count is asserted exactly. |
| SUP-13 | Unauthorised actions are rejected: unknown operator; missing `--apply` (dry run, no write); invalid evidence reference or one containing `@`; history cap reached |
| SUP-14 | Durable restart and audit integrity: a kill between the read and the conditional write → no change or a complete change, never partial. `version` conflicts are retried safely. History entries are never rewritten. |
| SUP-15 | Repeated known-invalid submissions: N new Applications with a suppressed address → **zero** additional acknowledgements (SMTP counter 0), N `201`s and N internal notifications |
| SUP-16 | **(revised, rev 5)** Rotation without loss of coverage: with the new key current and the old key verify-only, an address registered under the old key is still suppressed (zero submissions). `rekey` moves every entry that has a source; a second run changes nothing. Entries without a source stay `ACTIVE` under the old key and are still matched. `coverage` reports the old key as **not** safe to retire while any such entry remains. No entry is lifted by rotation. |
| SUP-17 | **Withdrawn in rev 5.** The acknowledgement budget is a separate proposal; its tests are BUD-1…BUD-10 in [`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md). |
| SUP-18 | **Missing historical key.** Remove a verify-only key from the configuration while `ACTIVE` entries remain under it; separately, replace a "lost" current key with a new one. A new Application for a suppressed address **and** one for an unsuppressed address: each returns `201`, the internal notification is sent, and the acknowledgement is `FAILED` / `SUPPRESSION_COVERAGE_INCOMPLETE` with zero submissions. No register entry changes state and no history entry is added. With the key restored, the next Application behaves normally; the blocked channels are selected by no retry flag except `--include-configuration`. |
| SUP-19 | **Incomplete migration.** Interrupt `rekey` (fault injection or a killed process) after *k* of *n* entries: each entry is wholly under the old or the new key; with both keys configured, addresses in both groups are suppressed and `coverage` is complete; a second run finishes the remaining entries and a third changes nothing. A digest-mismatch entry and a unique-index conflict are reported, stay under the old key, and keep it required. |
| SUP-20 | **Premature key retirement.** `coverage` reports a key with `ACTIVE` entries as not safe to retire. Removing it anyway gives the SUP-18 behaviour at the next attempt; no entry is lifted, no history is written, and `resolve-unrecoverable` refuses entries that still have a source. |
| SUP-21 | **Audited resolution of unrecoverable entries (corrected, OD-2026-11-04-02).** `resolve-unrecoverable` refuses without `--apply`, an authorised operator, `--confirm-key-unavailable`, a valid decision reference, a valid evidence reference or a matching expected count, and refuses while the key is configured. On success, exactly the expected entries become `LIFTED`, each with one `RELEASE_UNRECOVERABLE` history entry; there are zero submissions; earlier channels are unchanged. Coverage becomes complete — and the next Application is acknowledged normally — **only when no key is `RECOVERING`**. While the released entries' key (or any other) is `RECOVERING`, sending stays blocked until `recover-key --complete` succeeds and coverage is complete. |
| SUP-22 | **Key-material integrity (rev 7, specified with §4.5; PROPOSED).** Synthetic keys only. Each case asserts: zero SMTP submissions for every acknowledgement, the internal notification still sent, no entry lifted, no history written, the outcome `FAILED` / `SUPPRESSION_COVERAGE_INCOMPLETE`, and log lines with the key id and fixed reason only (no key, check value, digest or address). **22a restart:** entries and the check value written under id `k1` with bytes K1; the process restarts with id `k1` and bytes K1′ → blocked; `coverage` reports `KEY_MATERIAL_MISMATCH k1`. **22b restore:** a database restored from a snapshot taken under key generation 1 while the secret store holds generation 2 under the same id → blocked; with the matching bytes restored → coverage complete and a suppressed address matched again. **22c rotation:** current `k2` correct, verify-only `k1` with wrong bytes → blocked; `rekey` refuses to start; with correct `k1` bytes the rekey runs and ends with coverage complete. **22d missing check:** a configured key with `ACTIVE` entries but no check value → blocked (`KEY_CHECK_MISSING`); `key-register` for an id that already has a check value refuses and changes nothing; `add` refuses while the current key has no check value. **22e correct material:** all checks match → coverage complete; a suppressed address is matched under every configured key; a non-suppressed address proceeds to the unchanged r9 delivery. **22f comparison and output:** the comparison is constant-time on equal lengths; a check value of the wrong length is a mismatch, never an exception; no command or log prints a key or check value. **22g missing check under existing entries (rev 8):** an `ACTIVE` suppression written under id `k1` with bytes K1; the `k1` check value is then missing (deleted, or absent after a partial restore); the process runs with id `k1` and wrong bytes K1′ → every acknowledgement is blocked (`KEY_CHECK_MISSING`). `key-register --apply` for `k1` with K1′ is refused (`KEY_ID_ALREADY_USED`) and writes nothing; the next Application for the suppressed address **and** one for an unsuppressed address are still blocked, with zero submissions. The same refusal holds with the correct bytes K1, for an id with `LIFTED` entries only, and for an id whose key document is `RECOVERING` or `RETIRED`. Eligibility returns only through SUP-23. |
| SUP-23 | **Controlled recovery (rev 8; PROPOSED).** Synthetic keys only; real MongoDB replica set; SMTP counter. **23a ordinary rotation stays verified:** `rekey` refuses and writes nothing with incomplete coverage, with any configured key missing its check value or mismatching, with an `ACTIVE` entry under an unconfigured id, or with a `RECOVERING` key document; no run ever writes `SOURCE_UNVERIFIED`. **23b recovery refusals:** `recover-key` writes nothing without `--apply` (dry run with counts), for an unknown operator, with an invalid or missing decision or evidence reference, without `--confirm-key-unavailable`, while the id is still configured, while the current key is missing, unverified or the same id, with a first-run count that differs, with a different decision reference on a later run, or for a `RETIRED` id. **23c blocked throughout:** a lost current key `k1` (and, separately, the SUP-22g untrusted `k1`); recovery started; interrupted after *k* of *n* entries; all entries with a source moved; source-less entries still present. At every stage, a new Application for a suppressed address and one for an unsuppressed address each return `201`, send the internal notification, and record the acknowledgement `FAILED` / `SUPPRESSION_COVERAGE_INCOMPLETE` with zero submissions. **23d durable and audited:** a killed process between the read and the conditional write leaves each entry wholly under `k1` or under the current key; a re-run continues and a third run changes nothing. Each moved entry has exactly one `REKEY` / `SOURCE_UNVERIFIED` history entry with the decision reference; no history entry is rewritten; `version` conflicts are retried safely. **23e unresolved entries preserved:** source-less entries and conflicts stay `ACTIVE` under `k1`, unchanged, and are reported. `--complete` refuses while any remain. `resolve-unrecoverable` releases only the source-less ones (SUP-21). `lift --reason SUPERSEDED` closes a conflict only while the address is `ACTIVE` under the current key, and is refused otherwise. A `CONFLICT_LIFTED` entry is left unchanged. **23f completion:** with no `ACTIVE` entry left under `k1`, `--complete` sets it `RETIRED` and `coverage` reports `COVERAGE_COMPLETE`. A new Application for a recovered suppressed address → `RECIPIENT_SUPPRESSED`, zero submissions; for an unsuppressed address → the unchanged r9 delivery. Channels blocked earlier are selected only by `--include-configuration`. Configuring `k1` again blocks every acknowledgement (`KEY_NOT_TRUSTED`), and `key-register k1` is refused. |

**Rev 8.2 cases (B7 r3 review; PROPOSED with §9):**

| # | Case |
| --- | --- |
| SUP-24 | **A consistent authorisation view under key migration (§9.1).** Real MongoDB; the real gate and notifier; SMTP counter. For each sender keyring — old `{k1}`, both `{k2, k1}`, new `{k2}` — and each order of the two send-path reads (coverage first, match first), a key step is executed **exactly between** the two reads: a move `k1 → k2`; a move followed at once by a prune attempt; a prune of the `k1` alias after the quiet period. For a suppressed address the outcome is never `PROCEED`: `FAILED` / `RECIPIENT_SUPPRESSED` or `SUPPRESSION_COVERAGE_INCOMPLETE`, **zero** submissions. A control proves the same steered path acknowledges an unsuppressed address. Mutation checks: replacing the alias, dropping the quiet period, or reading coverage from the primary lookup only each make it fail. SUP-12 (add versus send) is unchanged and still passes. *(Rev 8.3, §9.6: the cases now run through the real `readForAcknowledgement`. The "prune attempt" really prunes, at once, and the prune no longer waits for any period. `SUPPRESSION_CHECK_UNAVAILABLE` with reason `REGISTER_CHANGED` joins the allowed outcomes.)* |
| SUP-24b | **Clock-free authorisation (rev 8.3, §9.6).** The exact ordering, with operator B's clock 11 minutes ahead, and again with operator A's clock 11 minutes behind: an old-key sender `{k1}` reads coverage; A moves the suppression `k1 → k2`; B prunes at once; the sender reads the match. A third case has A's move really held at the server (fail point) while the sender reads coverage. Each gives **zero** submissions and `FAILED` / `SUPPRESSION_CHECK_UNAVAILABLE` (`REGISTER_CHANGED`). On the rev 8.2 code the first two **sent**. Controls: a move between the reads still lets an unsuppressed address through (`SENT`); a prune between the reads defers it, and the normal retry sends it once. |
| SUP-25 | **Bounded, resumable passes (§9.2).** An unresolved prefix (source-less entries) longer than `--limit`, followed by eligible entries: a run examines `--limit` entries and returns `nextAfter`; a run with `--after` reaches and moves the eligible ones. An interrupted pass (fault injection) reports `resumeAfter`; resuming completes it with exactly one `REKEY` per entry. The unresolved entries and their history stay byte-for-byte unchanged. Both `rekey` and `recover-key`. An invalid cursor is refused. |
| SUP-13b | **History cap (§9.5).** Near the cap, a duplicate report only increments `duplicateReports`. At the cap, a duplicate report and a re-apply are refused (`HISTORY_CAP_REACHED`) in a dry run and with `--apply`, and nothing is written. Alias pruning at the cap writes no history entry. |

**Live verification** (separately authorised later): one real asynchronous Titan DSN processed end to end by the operator command against a non-production database. **Not authorised now.**

## 9. Rev 8.2 — B7 r3 review corrections (PROPOSED for GPT review and owner confirmation)

These are corrections to the approved rev 8.1, made because GPT's B7 r2 review found defects in the implementation. Each is implemented on `b7-work` for review. The parameter values chosen here (the quiet period, the per-entry lookup bound) are implementation choices and need confirmation. Production acknowledgements stay refused (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`).

### 9.1 A consistent authorisation view under key migration (finding 1)

**Defect.** §3.2 steps 1 and 3 are two reads. Under rev 8.1 a `rekey` could move an entry between them: a sender still configured with only the old key `k1` could read coverage **before** the move (every key id configured, so complete) and the match **after** it (no entry under `k1` any more, so no match), and send to a suppressed address.

**Correction — aliases with a quiet period.** Instead of making the two reads one snapshot (which needs a replica set and transactions), the register never presents a state in which a key the entry was ever matchable under silently disappears inside one read window:

- Each entry holds `lookups`: the **primary** (`retiredAt: null`, equal to `lookup`) and **aliases**. A move (`rekey`, `recover-key`) adds the new primary in the same conditional write and keeps the old one as an alias, stamped `retiredAt`. Both reads use `lookups` only: coverage takes every key id in `lookups` of an `ACTIVE` entry; the match is `lookups: { $elemMatch: { keyId, digest } }` for each configured pair.
- *(Superseded by rev 8.3, §9.6: there is no quiet period; an alias is removed by the next run, stamped.)* An alias is removed only once it has been an alias for at least `ALIAS_QUIET_PERIOD_MS` = **10 minutes** (by the operator's clock). Removal is done by `rekey` (all keys) and `recover-key --complete` (that key), bounded, one conditional durable write per entry, with **no** history entry because no suppression decision changes.
- `coverage` counts aliases per key id; a key is `safeToRetire` only with zero `ACTIVE` entries **and** zero aliases. `recover-key --complete` refuses with `ALIASES_PENDING` while an alias under the id is younger than the quiet period *(superseded, §9.6: while aliases beyond `--limit` remain)*.
- An entry holds at most `MAX_LOOKUPS` = **8** lookups. A move that would exceed it is skipped and reported (`lookupCap`); the entry stays matchable under its current primary. This bounds one document; it is not a limit on configured keys (§9.3).

**Why it is safe (rev 8.2 — WITHDRAWN in rev 8.3; see §9.6).** GPT's r3 review showed this argument rests on operator clocks and on when a delayed move becomes visible. SUP-24b demonstrates it on the rev 8.2 code: with operator B's clock 11 minutes ahead (or A's 11 minutes behind) an old-key sender was acknowledged. The text is kept as the record. A `PROCEED` needs both reads to finish within the one send-path time bound `T` (`SUPPRESSION_LOOKUP_TIMEOUT_MS`, at most 10 s); otherwise the attempt is `SUPPRESSION_CHECK_UNAVAILABLE`. Take any sender keyring and an `ACTIVE` entry:

- if the sender holds a key the entry is matchable under at the moment of either read, coverage shows that key as configured and the match finds the entry;
- if the sender holds none of them, coverage shows an unconfigured key id and the attempt is `SUPPRESSION_COVERAGE_INCOMPLETE`.

A move only **adds** a key id, so neither read can lose the entry because of it. Only a prune removes a key id, and it removes only aliases at least 10 minutes old, so a move and the prune of the alias it created are never both inside one window of `T`. This holds whatever the order of the two reads, on a standalone server and on a replica set. **Assumptions (for confirmation):** operator machines' clocks agree within the margin of the quiet period over `T` (about 9 min 50 s), and a move whose write outcome is unknown is not applied by the server more than that margin after its stamp. The second is not enforced by the server: the command bounds each write on the client (the write timeout plus 1 s), stops on an unknown outcome, and the operator re-runs it.

**Cost.** While aliases exist, a sender configured without the old key is blocked (`SUPPRESSION_COVERAGE_INCOMPLETE`), never sent. So the old key is removed from configuration only after `coverage` shows `safeToRetire`, which is the rev 8.1 retirement rule with aliases added. The add-versus-send boundary of §3.5 (SUP-12) is unchanged.

### 9.2 Bounded, resumable passes (finding 2)

**Defect.** `rekey` and `recover-key` selected the first `--limit` matching entries on every run. Entries that stay unresolved (no source, conflict, digest mismatch, history cap) could fill every batch, so later eligible entries were never reached.

**Correction.** Each run examines at most `--limit` entries in `_id` order **after** an optional `--after <id>` cursor, and returns `examined` and `nextAfter` (`null` when the end is reached). The next run continues with `--after <nextAfter>`. If a write's outcome is unknown, the command stops and prints `resumeAfter`: the last entry fully handled, so the failed one is examined again (every step is idempotent). An invalid cursor is refused (`INVALID_CURSOR`). Unresolved entries are left unchanged, with their history, and counted in every run that examines them. Coverage preconditions, the decision-reference checks and the counts are unchanged.

### 9.3 No fixed maximum on verify-only keys (finding 3)

§3.2 step 2 says there is **no fixed maximum** on verify-only previous keys. The rev 8.1 implementation refused more than 8 (`MAX_PREVIOUS_KEYS`), which contradicted it. The **requirement is unchanged**. The implementation now accepts any number of previous keys. `SUPPRESSION_HMAC_PREVIOUS_KEYS` is bounded only as an input: at most 32,767 characters in all, the Windows environment-variable limit. Each configured key costs one more indexed lookup within the same time bound `T`.

### 9.4 The SUP-6 data-inventory entry (finding 4)

SUP-6 requires the entry to be listed in the inventory. The minimal entry is [`docs/privacy/DATA_INVENTORY.md`](../privacy/DATA_INVENTORY.md). It covers the register, the key documents, `lastStatusCode`, the key material and the logs. Undecided production inputs are marked **AWAITING INPUT**: provider, region, contractual role, transfers, operator tokens, the key-copy location and the log destination. Retention stays **AWAITING** (Doc 13 §187). An offline drift test checks that the entry lists every field the two models store.

### 9.5 The history cap on the duplicate-report path (finding 5)

§3.1 refuses every further action at the history cap. The rev 8.1 duplicate path checked only "near the cap", so a duplicate report at the cap still incremented `duplicateReports`. Now:

- a duplicate report **at** the cap is refused (`HISTORY_CAP_REACHED`) before anything is written, in a dry run too;
- a duplicate **near** the cap (from 17 entries) only increments `duplicateReports`, with no source and no history entry, as before;
- a re-apply at the cap is also refused in its dry run, so the dry run reports what `--apply` would do.

The other write paths already refused at the cap: `lift`, `forget` source removal, `resolve-unrecoverable`, and the `rekey` / `recover-key` moves, which skip and report the entry. A privacy-request deletion by `forget` is not a history action and still deletes. Alias pruning records no action, so it is not refused: refusing it would keep an old key id in coverage permanently for that entry.

### 9.6 Rev 8.3 — clock-free authorisation (supersedes the quiet period of §9.1; B7 r3 review)

**Defect (r3).** Rev 8.2 decided whether an alias could be pruned by comparing its `retiredAt` stamp, written by one operator's clock, with another operator's clock. Two things could therefore let the prune fall inside a sender's read window: an operator clock running ahead (or behind), and a move that became visible long after it was stamped. **Demonstrated on `45e2bf2`** (SUP-24b, real MongoDB, local SMTP counter):

1. an old-key sender `{k1}` reads coverage;
2. operator A moves the `ACTIVE` suppression `k1 → k2`;
3. operator B, with its clock 11 minutes ahead, prunes at once;
4. the sender reads the match.

The gate returned `PROCEED` and the suppressed address was submitted to (RCPT 1 → 2, acknowledgement `SENT`). The same happened with A's clock 11 minutes behind.

**Correction — a prune sequence read before and after.**

- **The stamp.** Every alias prune sets the entry's `pruneSeq` to a fresh value in the **same** conditional, durable write as the removal. The value comes from one counter document (`recipient_suppression_sequence`, `_id: alias-prune`) and is allocated **after** the entry was read. The counter is raised above the highest stored stamp first, so a lost or restored counter never repeats a value in use. A stored stamp never decreases (validation).
- **What does not stamp.** Moves, adds, duplicate reports, lifts and `forget` never change `pruneSeq`.
- **The send-path read** is three ordered phases inside the one time bound `T`:
  1. the highest stamp `s1`;
  2. coverage and the match (issued together);
  3. the highest stamp `s2`.
- **The gate** returns `PROCEED` only when the register confirms `s1 = s2`. Otherwise the attempt is `FAILED` / `SUPPRESSION_CHECK_UNAVAILABLE` (TRANSIENT, log reason `REGISTER_CHANGED`), which the normal bounded retry re-checks. A match still suppresses, and incomplete coverage still blocks.
- **No quiet period.** `ALIAS_QUIET_PERIOD_MS` is removed. Aliases are pruned by the next `rekey` run, and by `recover-key --complete` for that key. `retiredAt` remains, informational only; no decision reads it.

**Why it is safe (no clock, no timing assumption).** Take an `ACTIVE` entry E for the address and a sender keyring R.

1. **One key change between the reads is harmless.** A move only adds a lookup and keeps the old one. A prune removes only an alias, never the primary. So the two lookup sets the reads can observe always share a key. If R holds a key of the set coverage saw, coverage is complete only if R holds every such key, and the match then finds E under the shared key. If R holds none, coverage reports `KEY_NOT_CONFIGURED`.
2. **Two changes are needed to miss E**, and they must be a move followed by a prune that removes the old primary's alias. The primary can only stop being primary through a move, and only a prune removes a key.
3. **That prune's write is conditional on E's version**, and that version includes the move. So its operator read E after the move was visible, which is after the sender's first phase. The stamp was allocated after that read, so it exceeds every stamp visible at `s1`.
4. **The stamp is still visible at `s2`.** The prune is visible before `s2`, E still exists, and E's stamp only grows. So `s2 > s1`, and the gate does not `PROCEED`.
5. **If E was deleted in the window** (`forget` for a privacy request), the address was intentionally re-enabled, as with a lift (§3.5).

The argument uses only single-document atomicity, conditional writes on `version`, and the counter. It is unaffected by operator clocks, by how long a write is delayed, and by how long the sender takes between its reads. It works on a standalone server and on a replica set.

**Cost.** An acknowledgement whose check overlaps an alias prune is deferred, not sent. It is TRANSIENT, and the normal retry sends it once. Moves alone defer nothing, and SUP-12 (add versus send) is unchanged. Each prune costs one extra read and one counter write; each send-path check costs two index point reads.

**Tests.**

- **SUP-24b:** the exact ordering above with B's clock +11 min, with A's clock −11 min, and with A's move really held at the server (fail point) while the sender reads coverage. Each gives zero submissions and `REGISTER_CHANGED`.
- **SUP-24:** 18 interleavings, now through the real `readForAcknowledgement` via a model-level seam that only delays when its queries start.
- **Positive control:** a move between the reads still lets an unsuppressed address through (`SENT`).
- **Cost and recovery:** a prune between the reads defers an unsuppressed acknowledgement, and the retry sends it once.
- **Counter loss; monotonic stamp; `ALIASES_PENDING` beyond `--limit`.**
- **Mutation checks:** seven controls were each disabled in turn.
  - Five cause a real submission to the suppressed address: ignoring the change, not stamping, reading the stamp only once, replacing the alias instead of keeping it, and taking coverage from the primary lookup only.
  - Two are caught by their own tests: not raising the counter, and removing the monotonic guard.

