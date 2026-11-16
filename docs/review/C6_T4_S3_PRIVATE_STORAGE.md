# C6-T4 — S3-compatible private résumé storage (implementation record)

| | |
| --- | --- |
| Task | **C6-T4**, C6 plan revision 3, §10 step 2a |
| Authorised by | [Owner record 2026-11-16 (2)](OWNER_RECORD_2026-11-16_C6_T3_ACCEPTANCE_AND_C6_T4_AUTHORISATION.md), §2 — local implementation only |
| Recorded against | Doc 15 §§97–106 (storage hosting class, interface, provider requirements, S3 preference, public access, credential, encryption, durability); Doc 13 §§101, 108–111 (credential scope, exposure, access control, encryption, transport); Doc 09 §§101–108, 116–119, 170 (keys, adapter, production storage, object-first persistence, no retrieval API); Doc 10 §§94–108 (résumé metadata); Doc 17 (evidence) |
| Status | Implemented and tested locally on `c6-work`; **correction 1** applied (§5). **Not accepted** — that is the owner's decision, after Astra's review. Nothing pushed |

## 1. What was built

- `backend/src/integrations/storage/s3PrivateStorage.js`: the S3-compatible driver, behind the accepted B4 interface (`init`, `isReady`, `storePrivateResume`, `deletePrivateObject`, `statPrivateObject`, `listPrivateObjects`, `close`).
- Signing and requests in `s3/sigv4.js` and `s3/s3Http.js`: SigV4, one attempt per request, explicit timeout, TLS verified.
- Selection: `RESUME_STORAGE_DRIVER=s3`, with seven `RESUME_STORAGE_S3_*` variables validated at start-up (`config/env.js`). The variables are listed in `backend/README.md`.
- `storageProvider` value: `S3_COMPATIBLE` (Doc 10 §95's own example). **No data-model or API change.** No new npm dependency, and no lockfile change.
- The local driver, existing records, key generation, metadata, byte-length and SHA-256 semantics are **unchanged**; the shared contract suite proves both drivers behave the same.

## 2. Settled in implementation — for the reviewer

| Detail | Choice | Why |
| --- | --- | --- |
| Client | A small in-repository SigV4 client, not an SDK | One attempt per request, with no hidden retry. A retried conditional PUT whose first attempt succeeded would look like a key collision. No new dependency. It is checked against AWS's published example, against botocore, and against the test double's signature check |
| Integrity in transit | The SHA-256 is sent as the signed payload hash and as `x-amz-checksum-sha256`; the driver counts and hashes while sending; it checks the stored object (HEAD) afterwards | Real providers refuse mismatched bytes. The test double does not, so the driver's own checks are what the local evidence shows |
| A lost answer | The store is asked once (HEAD); success only when the object carries **this attempt's ownership marker** and the right length and SHA-256; otherwise 503 and no Application (correction 1) | Object-first: an uncertain write never becomes a fake success, never adopts another writer's object, and never deletes an object it did not write |
| Readiness | Probe at start-up only, as for the local driver | Unchanged B4 design; a runtime outage gives 503 per submission (stack check A7). Re-probing is a possible later change |
| Public-read probe | `init` writes a synthetic probe under a representative résumé key and requires an **explicit** anonymous denial (401/403); anything else refuses start-up; cleanup must be confirmed (correction 1) | A local, provider-independent check of Doc 13 §108 for one résumé key; the provider's policy remains hosted verification |

## 3. Canonical-document synchronisation (Doc 00 §5) — proposals, not adoption

| Document | Proposed addition |
| --- | --- |
| **Doc 15** (environment variables; storage) | The `RESUME_STORAGE_S3_*` names and rules; "`RESUME_STORAGE_DRIVER=s3` for Review and Production; there is no fallback to local storage; a refused, unreachable, untrusted or publicly readable store stops the backend at start-up" |
| **Doc 13** (§§108–111) | "The backend verifies at start-up that an anonymous read of a synthetic probe under a representative résumé key is explicitly denied, and that the probe is removed; storage transport is HTTPS with certificate verification that cannot be disabled" |
| **Doc 09** (§§116–119) | "A storage write whose answer is lost is resolved by checking the object and its per-attempt ownership marker; an object the attempt did not write is never adopted or deleted; if ownership cannot be established, the submission fails (503) and the object is left for reconciliation. Reconciliation acts only on a complete, validated listing" |
| **Doc 00** | The change-log entry for this record |

**NOT MADE.** The canonical collection is read-only here, and adoption is the owner's act.

## 4. Remaining for hosted verification

- The provider's access policy (bucket private, credential scope).
- Encryption at rest.
- Region or jurisdiction.
- Durability, backup copy and restore (C6 plan §5).
- TLS from the host to the real endpoint, and the provider's handling of `If-None-Match` and checksum headers.

## 5. Correction 1 (Astra's review of `01ddc2f`)

| Finding | Before (`01ddc2f`) | After |
| --- | --- | --- |
| 1. Ownership after an uncertain PUT | An object with the expected key, length and recorded SHA-256 was adopted; on a local integrity error it was deleted — even if another writer had put it there | Every PUT carries a fresh 128-bit marker (`x-amz-meta-attempt`). Only an object with this attempt's marker is adopted (complete) or deleted (wrong). Any other object is preserved and the submission fails with the generic 503 (`OUTCOME_UNKNOWN`, `outcome: NOT_OWNED`). An absent object is logged as `ABSENT_AT_OBSERVATION`, because a timed-out PUT can still land |
| 2. Start-up privacy check | Probe under `probes/` (a different prefix from résumés); only a 2xx anonymous answer refused start-up; the DELETE result was ignored | Probe under a representative résumé key; an explicit 401/403 is required (2xx `PUBLIC_ACCESS`; redirect, 404, 5xx, reset, timeout `PUBLIC_ACCESS_UNVERIFIED`); cleanup confirmed by DELETE then HEAD 404, else `PROBE_CLEANUP_FAILED` |
| 3. Reconciliation listing | Pages parsed by pattern; a malformed page read as an empty or partial listing | Strict page validation (`parseListObjectsV2`); any invalid page fails the whole listing (`LISTING_INVALID`): no report, no deletion. The CLI prints the fixed message and exits non-zero |

Residual, documented: between the HEAD that proves ownership and the DELETE of
this attempt's own wrong object, no other writer can create an object under
the key (every writer uses `If-None-Match: *`); only a deletion can intervene.
The real provider's policy, its `If-None-Match` handling and its listing
format remain hosted checks (§4).
