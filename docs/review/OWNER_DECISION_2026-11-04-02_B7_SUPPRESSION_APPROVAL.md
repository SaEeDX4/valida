# Owner decision OD-2026-11-04-02 — B7 recipient-suppression design approved; implementation authorised

| | |
| --- | --- |
| Identifier | **OD-2026-11-04-02**. This is the next free identifier after OD-2026-11-04-01, the B6 acceptance and B7 handoff. No existing identifier is reused. |
| Date | 2026-11-04 |
| Decided by | The owner (Saeed), relayed in the B7 authorisation message of 2026-11-04 |
| Applies to | [`RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md) **rev 8** and [`B7_SUPPRESSION_DECISION_PROPOSAL.md`](B7_SUPPRESSION_DECISION_PROPOSAL.md) (decisions S1–S6) |
| Checkpoint | B6 accepted and published at `2b00a6288ae8c1037dfa972c56c45ec94816e44d` (not reopened). Local `b7-work` at `6b8e9ca802d8f40acde97a30989ada166b697005` holds design rev 8. |

## 1. Decisions

| # | Decision | Outcome |
| --- | --- | --- |
| S1 | Storage of the lookup value | **Keyed HMAC — APPROVED.** The plaintext alternative is not chosen. |
| S2 | Fail-closed key lifecycle (§4.2, §4.4) | **APPROVED** |
| S3 | Key-material integrity (§4.5.1): check values, `recipient_suppression_keys`, `key-register` for fresh ids only; SUP-22a–g | **APPROVED** |
| S4 | Controlled recovery separate from rotation (§3.4, §4.2); SUP-23a–f | **APPROVED** |
| S5 | Operator identifiers: the `SUPPRESSION_OPERATOR_IDS` mechanism | **APPROVED.** The production tokens are a C6 prerequisite. |
| S6 | Acceptance set SUP-1…16 and SUP-18…23 (SUP-17 withdrawn) | **APPROVED** |

## 2. SUP-21 correction (part of this decision)

Resolving source-less entries (`resolve-unrecoverable`) must **not** make acknowledgements eligible again while any key is `RECOVERING`. Sending stays blocked until controlled completion (`recover-key --complete`) succeeds **and** coverage is complete.

The design rev 8 rule already blocks sending while any key document is `RECOVERING` (§4.5.1). The corrected SUP-21 text is recorded in design §8 (rev 8.1), and the behaviour is tested.

## 3. What this authorises

- Implementation in B7, on `b7-work`, of the approved design:
  - the register;
  - the send-path checks;
  - the operator commands;
  - key integrity;
  - verified rotation;
  - controlled recovery.
- Application acceptance, internal notifications, idempotency, durable writes and bounded operations are preserved.
- SUP-1…16 and SUP-18…23 executed with synthetic data and keys, a local SMTP submission counter, and a disposable real MongoDB replica set where available. A check that could not run is labelled NOT RUN.
- One review package, followed by one Windows/MongoDB verification against the final commit after GPT review.

## 4. What it does not authorise

- Live email.
- Real credentials or keys.
- Production changes.
- Deployment.
- Pushing or merging B7.
- Marking B7 accepted.
- **The unconditional production refusal of candidate acknowledgements stays enabled** (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`). Removing or relaxing it is a separate decision after G-SUP evidence is accepted.

## 5. C6 prerequisites — not blockers to the synthetic implementation

- Production key placement (owner).
- The protected key-copy location: **AWAITING INPUT**.
- The production operator tokens.
