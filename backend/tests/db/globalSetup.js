import { checkTestDatabaseTarget } from '../../scripts/test-database.mjs';

/**
 * Vitest global setup for `npm run test:db`.
 *
 * Runs once in the main process before any test file is loaded. If the target
 * is not an explicitly disposable test database (see scripts/test-database.mjs)
 * the whole run is aborted here, so no test file — and nothing destructive — is
 * ever started. Every file repeats the check on load as a second line of
 * defence.
 */
export default function refuseUnsafeDatabaseTarget() {
  const result = checkTestDatabaseTarget({ env: process.env });
  if (!result.ok) {
    throw new Error(`[test:db] ${result.reason}`);
  }
}
