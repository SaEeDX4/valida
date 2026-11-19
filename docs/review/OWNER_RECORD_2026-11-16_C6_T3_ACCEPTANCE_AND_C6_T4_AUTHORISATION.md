# Owner record 2026-11-16 (2) — C6-T3 accepted; C6-T4 authorised

| | |
| --- | --- |
| Date | 2026-11-16 |
| Decided by | Saeed (owner), after Astra's review of C6-T3 and its correction 1 |
| Source | The owner's instruction authorising "C6-T4, local private résumé storage" (2026-11-16), which names the accepted local `c6-work` baseline |
| Recorded by | Claude, on the local branch `c6-work`. Nothing is pushed |
| Governing | Doc 00 §5 (change control); Doc 18 C6 (§§173–176); C6 plan revision 3, §10 step 2a |
| Not an owner-decision identifier | No new `OD-` identifier is allocated. This record cannot be used as `RECRUITMENT_PUBLIC_AUTHORISATION` |

## 1. C6-T3 — accepted

| | |
| --- | --- |
| Accepted commit | **`9fa42b0f2fc5579228b65794316cce59320ffd76`**, tree **`11bcc56500b5bda134c8748e1720027543712e81`** — C6-T3 with correction 1 (production requires the explicit literal `SITE_ACCESS=public`) |
| Record | [`C6_T3_PRIVATE_REVIEW_ACCESS.md`](C6_T3_PRIVATE_REVIEW_ACCESS.md) |
| Evidence | The C6-T3 handoff and the correction-1 handoff (outside the repository), unchanged |

The behaviour is accepted as implemented at that commit. That includes the remaining implementation choices recorded in the T3 handoff:

- the `AUTHORIZATION_DENIED` code with Doc 06 §188 wording;
- `/healthz` in every mode;
- a Review document server without a key gives 503 Job pages;
- an indexable build is refused in Review.

**Still separately open:**

- **Canonical adoption.** The proposed entries for Docs 09/11, 13, 15, 16 and 00 (T1, T2 and T3 records, §4) are proposals until the owner adopts them under Doc 00 §5. Accepting the implementation does not adopt them.
- **G-ACCESS.** Hosted access verification for each real hostname (H1–H9) before any synthetic Job is provisioned there.

## 2. C6-T4 — authorised (local only)

**Scope:** plan step 2a, local private résumé storage. That covers:

- an explicitly selected S3-compatible private storage driver behind the accepted B4 interface (factory, readiness probe, Apply flow, reconciliation), keeping the local driver, existing records, key generation, metadata, exact byte length and SHA-256 semantics;
- configuration validation that fails closed, with no fallback to disk;
- the TLS requirement for hosted endpoints;
- verification through the real application paths with a disposable database, synthetic résumé bytes and a local S3-compatible test double;
- documentation, and one handoff for Astra.

**Outside this authorisation:** provider selection or provisioning, purchases, real credentials, GitHub writes, deployment, DNS, live email, changes to `C:\ME\Valida`, and later C6 implementation. Production candidate acknowledgements stay disabled. The genuine vacancy stays Draft through the Release E gates, including E6.

## 3. Still open, tracked separately

- G-ACCESS (H1–H9) for each real hostname.
- Canonical adoption of the T1–T3 proposals (and of any T4 proposal).
- Delegated-read rate limiting; the `mongoose` advisory; Safari on real devices (OPEN).
- For T4, after hosting: the provider's access policy, encryption at rest, region or jurisdiction, and restore behaviour. These need the real provider (C6 plan §§3.4, 5).
