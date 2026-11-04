# B7 — recipient suppression: consolidated owner-decision proposal

| | |
| --- | --- |
| For | The owner, after GPT's review of design rev 8 |
| Design | [`docs/architecture/RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md) **rev 8** (PROPOSED) |
| Plan | [`IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md`](IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md) Part B. Preconditions 1–2 are met. This proposal is what preconditions 3 and 5 need. |
| Already approved — not asked again | D2a approach (OD-2026-10-26-01); DEV-B6-04 with the SUP-1 amendment (OD-2026-11-02-03); G-SUP closed (OD-2026-11-02-03 item 5); B7 authorisation (OD-2026-11-04-01) |
| Status | **PROPOSED.** Nothing in this proposal is implemented. Production start-up keeps refusing `APPLICATION_ACKNOWLEDGEMENT_ENABLED=true` (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`, commit `9e86465`). |

## 1. Decisions requested — one approval covers all six

| # | Decision | Recommendation | Design reference |
| --- | --- | --- | --- |
| S1 | **Storage of the lookup value** | **Keyed HMAC** — no second plaintext copy of candidate addresses. *Alternative:* plaintext `emailNormalized` in the same restricted database: simpler, with no key, rotation or recovery (S2–S4 would then fall away), but it keeps a plaintext copy that can outlive the Application. | §4.1 |
| S2 | **Fail-closed key lifecycle**: rotation never lifts an entry; a missing or retired key blocks every acknowledgement (`SUPPRESSION_COVERAGE_INCOMPLETE`); entries with neither key nor source are released only by an audited owner decision (`resolve-unrecoverable`) | Approve | §4.2, §4.4 |
| S3 | **Key-material integrity**: one check value per key id in `recipient_suppression_keys`, a Doc 10 addition with states `ACTIVE`, `RECOVERING` and `RETIRED`. The check is verified on every acknowledgement attempt, by `coverage` and around `rekey`. `key-register` accepts **fresh ids only**, so a missing check value can never be replaced and an id with existing entries is never re-trusted. | Approve | §4.5.1; SUP-22a–g |
| S4 | **Controlled recovery, separate from rotation**: `rekey` handles verified rotation only. A lost or untrusted key is recovered only by `recover-key`, which takes the following steps. | Approve | §3.4, §4.2; SUP-23a–f |
| | 1. An owner decision reference is required. | | |
| | 2. The bad id is marked `RECOVERING` (permanently untrusted). | | |
| | 3. Each entry is re-keyed from its stored source address, recorded as `SOURCE_UNVERIFIED`. | | |
| | 4. Source-less entries and conflicts are preserved and reported. | | |
| | 5. `lift --reason SUPERSEDED` closes a conflict only while the address stays suppressed under the current key. | | |
| | 6. `--complete` marks the id `RETIRED`. | | |
| | Acknowledgements stay blocked until `--complete` succeeds and coverage is complete. | | |
| S5 | **Operator identifiers**: a non-secret allowlist `SUPPRESSION_OPERATOR_IDS`. History records only the token, never an email address. | Approve the mechanism. Tests use synthetic tokens; the owner supplies the production tokens at C6. | §3.4 |
| S6 | **Acceptance set for G-SUP**: SUP-1…16 and SUP-18…23 (SUP-17 withdrawn), executed against a real MongoDB replica set and the local SMTP test server, plus the owner's Windows run | Approve | §8 |

**Not proposed.** A proof-based way to re-trust an id whose check value is missing — recomputing digests of entries that still have a source — was considered and left out. Rev 8 instead treats such an id as untrusted for good. Its source-less entries then go to the audited resolution, even if the correct bytes still exist.

## 2. What approval authorises — and what it does not

**Authorises:**

- Implementation of plan B.2, plus S3 and S4, on `b7-work`, as one separately reviewable change.
- Synthetic sandbox keys only.
- The listed tests, written and executed.
- A focused GPT review.
- Then **one** owner Windows + MongoDB verification of `verify:b7`, against the final reviewed commit.

**Does not authorise:**

- Enabling candidate acknowledgements anywhere in production.
- Removing or relaxing the production start-up refusal. Replacing it with a key-based refusal is a separate decision once G-SUP evidence is accepted.
- Creating a production key, or Claude seeing any real key.
- A live DSN test.
- The acknowledgement budget (D2b), R3 or message copy.
- Pushing or merging B7, or any deployment.

## 3. Remaining inputs (not needed to implement and test)

| Input | State | Needed before |
| --- | --- | --- |
| Location of the protected second copy of each production key | **AWAITING INPUT** | Placing a production key (C6) |
| The owner places the production HMAC key in the host secret store | Owner action, C6 | Any production acknowledgement |
| Production operator tokens for `SUPPRESSION_OPERATOR_IDS` | Owner, C6 | Production operator use |

## 4. Owner decision (to be completed by the owner)

> Decision S1: ☐ keyed HMAC ☐ plaintext alternative · S2–S6: ☐ approved ☐ changes required: ……
> Decision reference: OD-2026-__-__-__ · Date: ……
