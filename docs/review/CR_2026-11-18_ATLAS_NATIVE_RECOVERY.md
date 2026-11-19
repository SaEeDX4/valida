# Change record CR-2026-11-18-AN — Atlas-native recovery

| | |
| --- | --- |
| Authority | Owner instructions of 2026-11-18 (22:45 and 23:47 America/Vancouver). The application infrastructure is **Render and MongoDB Atlas only**; domains and email stay on the existing Bluehost and Titan accounts. The external journal, the encrypted export, the backup cron, their keys and buckets, and the second restore rehearsal are removed from the active plans and budgets |
| Doc 00 status | Recorded under Doc 00 change control. Synchronising the affected canonical sections (Docs 09, 10, 13, 15, 16, 17, 18) remains owner-approved canonical work |
| Base | `720af9366587611e1ea4f3b5ce81702450cc2637` |

## Changes

1. **The deletion journal is stored in Atlas.**
   - `BACKUP_JOURNAL_STORE=mongodb` is now the default. It uses the insert-only `deletion_journal` collection in the live cluster. Verification is unchanged: contiguous checkpoints chained by digest, the owner's anchor, and entries hashed. Every document's stored digest is re-checked on each read.
   - Two roles cover it. `valida_deletion_operator` gains only find and insert on `deletion_journal`. The new `valida_journal_reader` can only find.
   - The S3 store (`s3`) remains in the code but is inactive.
2. **Freshness rule.** The restore gate (step 1b) re-applies history only if it is known to be the newest:
   - the history came from the live journal, and that server identifies itself as `RECOVERY_LIVE_REPLICA_SET`; or
   - it came from the independent external journal (inactive).

   An offline export cannot show that no deletion followed it. Restoring from an export alone therefore fails with `DELETION_HISTORY_FRESHNESS_UNKNOWN`, writes nothing, and leaves the target closed. The only exception is `--owner-attestation <owner-record ref>`, which is recorded in the report.
3. **Atlas user management.** Atlas refuses `createRole` and `createUser`. `prepare-target --atlas-users` therefore writes only the restore authorisation and prints the restore-writer custom role. The owner creates that role in the Atlas console, with its user restricted to the target cluster. The gate still checks that user's privileges before the first write.
4. **Inactive, not deleted:** the encrypted recovery copy (`backup-create` / `backup-restore`), the S3 journal store and the B2 backup roles.

## Changed guarantees

| # | Before | After |
| --- | --- | --- |
| G1 | Deletion history was compliance-locked on a second provider | It lives inside the live Atlas cluster. Application roles can only insert. An Atlas Project Owner, or someone who has compromised the Atlas account, can still delete or alter it. That is **detected, not prevented**: the owner's anchor gives `STALE`, and digests give `TAMPERED`. Either way the restore fails closed |
| G2 | An independent encrypted daily copy existed | **Removed.** Only the Atlas Flex snapshots remain: the last 8 daily snapshots, no point-in-time restore. Losing the Atlas account means losing the data. RPO ≤ 24 h |
| G3 | Two hosted rehearsals (P-6, P-15) | P-6 only, restoring Flex to Flex |
| G4 | Restore users were created by command | They are created in the Atlas console and restricted to the target cluster. **Every live user must be restricted to the live cluster**, because Atlas users are project-wide |
| G5 | Loss of the live cluster was covered by the external journal | It is covered only by the owner's newest offline export, **with an owner attestation**. Without a fresh, attested export the restored target stays closed: availability is lost, privacy is not |

**Operating rule.** After each authorised deletion, the owner records the printed anchor in the owner record and keeps a `journal-export` file offline. The export holds ids, an opaque résumé reference and digests only.

**Attestation rule.** The owner attests an export only after confirming two things: the live journal cannot be recovered, and the export matches the newest anchor in the owner record.
