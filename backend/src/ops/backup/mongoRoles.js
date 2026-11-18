/**
 * Proposed (MongoDB-native launch change, r2) — the least-privilege database roles.
 *
 * The SAME definitions are created as Atlas custom database roles (actions on
 * a named database and collection) and, in the local role suites, with
 * createRole. No operational role holds UPDATE on `resume_files`. Index
 * creation is done once by the Project Owner (db:indexes).
 *
 * r2: the deletion history no longer lives in the primary database (it is the
 * independent journal, deletionJournal.js), so no role touches a deletion log
 * here. The restore writer exists ONLY on the temporary restore-target cluster
 * (created by the owner there, restricted to that cluster in Atlas).
 */
export const LIVE_ROLES = Object.freeze(['valida_api_runtime', 'valida_resume_storage', 'valida_deletion_operator', 'valida_resume_scanner', 'valida_backup_reader']);
export const RESTORE_TARGET_ROLES = Object.freeze(['valida_restore_writer', 'valida_restore_loader']);

export function roleDefinitions(db) {
  const on = (collection, actions) => ({ resource: { db, collection }, actions });
  return {
    // The API's database user (MONGODB_URI): the application collections, no résumé bytes.
    // listIndexes: the Apply path refuses to write unless the unique indexes exist (assertUniqueIndexes).
    valida_api_runtime: [
      on('applications', ['find', 'insert', 'update', 'listIndexes']),
      on('jobs', ['find']),
      on('recipient_suppressions', ['find']),
      on('recipient_suppression_keys', ['find']),
    ],
    // The API's storage user (RESUME_STORAGE_MONGODB_URI): résumé documents only; never update.
    valida_resume_storage: [on('resume_files', ['find', 'insert', 'remove'])],
    // The authorised-deletion operator: remove exact records (the history is written to the journal first).
    valida_deletion_operator: [on('applications', ['find', 'remove']), on('resume_files', ['find', 'remove'])],
    // The scanner (E4): reads résumés, records a bound scan result.
    // r3: per-version retry state (scanQueue.js) — the Application schema is unchanged.
    valida_resume_scanner: [on('applications', ['find', 'update']), on('resume_files', ['find']), on('scan_attempts', ['find', 'insert', 'update'])],
    // r3 (D-MN-2): the encrypted recovery copy reads every data collection at one snapshot; it writes nothing.
    valida_backup_reader: [
      on('applications', ['find']), on('resume_files', ['find']), on('jobs', ['find']),
      on('recipient_suppressions', ['find']), on('recipient_suppression_keys', ['find']),
    ],
  };
}

/**
 * Created on the RESTORE TARGET only. mode 'snapshot': re-applies deletions on a restored snapshot.
 * mode 'load' (r3, D-MN-2): loads a decrypted recovery copy into an EMPTY target, creates its indexes,
 * then re-applies deletions.
 */
export function restoreTargetRoleDefinitions(db, mode = 'snapshot') {
  const on = (collection, actions) => ({ resource: { db, collection }, actions });
  if (mode === 'load') {
    return {
      valida_restore_loader: [
        on('applications', ['find', 'insert', 'remove', 'listIndexes', 'createIndex']),
        on('resume_files', ['find', 'insert', 'remove', 'listIndexes', 'createIndex']),
        on('jobs', ['find', 'insert', 'listIndexes', 'createIndex']),
        on('recipient_suppressions', ['find', 'insert', 'listIndexes', 'createIndex']),
        on('recipient_suppression_keys', ['find', 'insert', 'listIndexes', 'createIndex']),
        on('restore_authorization', ['find']),
      ],
    };
  }
  return {
    valida_restore_writer: [
      on('applications', ['find', 'remove']),
      on('resume_files', ['find', 'remove']),
      on('restore_authorization', ['find']),
    ],
  };
}
