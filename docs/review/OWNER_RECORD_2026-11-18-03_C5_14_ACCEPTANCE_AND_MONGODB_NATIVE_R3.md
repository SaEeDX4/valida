# Owner record 2026-11-18-03 — C5-14 accepted; MongoDB-native R2 adopted as the engineering baseline; R3 corrections

| | |
| --- | --- |
| Date | 2026-11-18 |
| Decided by | Saeed (owner) |
| Source | The owner's instruction "Owner decision — accept C5-14 and proceed with one signed MongoDB correction on c6-work" (2026-11-18) |
| Recorded by | Claude, in the signed commit that carries the R3 change on `c6-work` |
| Governing | Doc 00 §5 (change control); Doc 13 §§70–74, 157–166; Doc 15 §§97–102, 176–208; Doc 18 C6 (§§173–182) |
| Not an owner-decision identifier | No new `OD-` identifier is allocated. This record cannot be used as `RECRUITMENT_PUBLIC_AUTHORISATION` |

## 1. C5-14 — accepted

| | |
| --- | --- |
| Accepted commit | **`29d5f2ea05e71803d98997ab36c9f6cdb87005f0`**, tree `6a205a5e…` |
| Change | Footer and cascade assertions recognise the web-font swap of a constant `ch` measure. The assertions cover visibility only |
| Evidence | PR #1, push of 2026-11-18. Both runs were attempt 1, all jobs green, and C5-14 passed on GitHub's runner: `ci` run 44301813135; `e2e` run 44301813144 |

## 2. MongoDB-native R2 — adopted as the engineering baseline

The owner adopts R2 as the baseline. R2 has three parts:

- **Storage:** résumés stored as one private document per immutable version in MongoDB.
- **Deletion history:** a durable journal in an independent, compliance-locked object store.
- **Restore safety:** restore targets positively identified before any write, with real ClamAV scanning and version-bound verdicts.

R2 is recorded in the external R2 package (decision sheet and evidence index of 2026-11-18). Adopting it as the engineering baseline does **not** authorise provisioning or spending. The canonical synchronisation of Docs 00/09/10/13/14/15/16/17/18 (change record `CR-PROPOSED-2026-11-18-MN`, revision 3) remains proposed until the owner approves it under Doc 00 §5.

## 3. R3 — authorised in this decision (repository engineering and PR CI only)

1. **Scanner queue starvation.**
   - New work is selected before retries, within a reserved share of each batch.
   - Retry state is kept per exact version in `scan_attempts`; the Application schema is unchanged.
   - Retries are bounded and use exponential backoff. Exhausted files stay FAILED and held, and are never released.
   - A backlog alert (exit 3) fires on an unscanned résumé that is too old, or on any exhausted file.
2. **D-MN-2 — independent encrypted recovery copy.**
   - All data collections are read in one MongoDB snapshot session: one defined recovery point (cluster time).
   - The copy is encrypted with AES-256-GCM in authenticated chunks. Its data key is wrapped for **two** recipients: the owner key and a sealed recovery key.
   - It is written with isolated credentials into a compliance-locked bucket.
   - Restore goes to an **empty**, positively identified target, followed by deletion replay.
   - Incomplete or unverifiable material is refused with zero writes.
   - Retention and expiry of these copies are stated in the Review authorisation sheet.
3. **The self-referential manifest is corrected.**
   - The R2 package's `SHA256SUMS.txt` listed itself: the file was created by the shell redirect before `find` ran. The manifest is now generated outside the directory it describes, and excludes itself.
   - The recovery copy's manifest never contains its own digest. That digest is printed by the dump and recorded by the owner.
4. **Publication.** One signed commit on `c6-work` whose parent is `29d5f2e`, pushed normally to PR #1, with CI followed to completion.

**Not authorised:**

- any change to `main`;
- paid provisioning or provider credentials;
- live email;
- production deployment;
- recruitment activation.

Each remains subject to an explicit owner decision.

## 4. Unchanged

- Production candidate acknowledgements stay disabled.
- The genuine vacancy stays Draft through the Release E gates, including E6 (OD-2026-11-09-03).
- The S3 driver and the accepted C6-T4/T6 tooling remain in the codebase as the documented alternative.
