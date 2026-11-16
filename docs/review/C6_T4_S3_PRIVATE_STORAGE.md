# C6-T4 — S3-compatible private résumé storage (implementation record)

| | |
| --- | --- |
| Task | **C6-T4**, C6 plan revision 3, §10 step 2a |
| Authorised by | [Owner record 2026-11-16 (2)](OWNER_RECORD_2026-11-16_C6_T3_ACCEPTANCE_AND_C6_T4_AUTHORISATION.md), §2 — local implementation only |
| Recorded against | Doc 15 §§97–106 (storage hosting class, interface, provider requirements, S3 preference, public access, credential, encryption, durability); Doc 13 §§101, 108–111 (credential scope, exposure, access control, encryption, transport); Doc 09 §§101–108, 116–119, 170 (keys, adapter, production storage, object-first persistence, no retrieval API); Doc 10 §§94–108 (résumé metadata); Doc 17 (evidence) |
| Status | Implemented and tested locally on `c6-work`. **Not accepted** — that is the owner's decision, after Astra's review. Nothing pushed |

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
| A lost answer | The store is asked once (HEAD); success only when the object is present with the right length and SHA-256; otherwise 503 and no Application | Object-first: an uncertain write never becomes a fake success, and never deletes a possibly valid object |
| Readiness | Probe at start-up only, as for the local driver | Unchanged B4 design; a runtime outage gives 503 per submission (stack check A7). Re-probing is a possible later change |
| Public-read probe | `init` refuses a store that serves an anonymous read | A local, provider-independent check of Doc 13 §108; the provider's policy remains hosted verification |

## 3. Canonical-document synchronisation (Doc 00 §5) — proposals, not adoption

| Document | Proposed addition |
| --- | --- |
| **Doc 15** (environment variables; storage) | The `RESUME_STORAGE_S3_*` names and rules; "`RESUME_STORAGE_DRIVER=s3` for Review and Production; there is no fallback to local storage; a refused, unreachable, untrusted or publicly readable store stops the backend at start-up" |
| **Doc 13** (§§108–111) | "The backend verifies at start-up that an anonymous read of a probe object is refused; storage transport is HTTPS with certificate verification that cannot be disabled" |
| **Doc 09** (§§116–119) | "A storage write whose answer is lost is resolved by checking the object; if that cannot be done, the submission fails (503) and the possible object is left for reconciliation" |
| **Doc 00** | The change-log entry for this record |

**NOT MADE.** The canonical collection is read-only here, and adoption is the owner's act.

## 4. Remaining for hosted verification

- The provider's access policy (bucket private, credential scope).
- Encryption at rest.
- Region or jurisdiction.
- Durability, backup copy and restore (C6 plan §5).
- TLS from the host to the real endpoint, and the provider's handling of `If-None-Match` and checksum headers.
