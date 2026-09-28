import { checkTestDatabaseTarget } from '../../scripts/test-database.mjs';

/**
 * Entry guard for every real-database test file (the global setup applies the
 * same check once before any file runs).
 *
 * Judged on the environment this test process was LAUNCHED with, before any
 * test builds a child environment that overrides MONGODB_URI. Throws — failing
 * the file — rather than skipping, so the database suite can never report
 * success without having touched a database, and never runs against a target
 * that is not an explicitly disposable test database.
 *
 * @returns {{ uri: string, databaseName: string }}
 */
export function requireTestDatabase() {
  const result = checkTestDatabaseTarget({ env: process.env });
  if (!result.ok) {
    throw new Error(
      `${result.reason} The real-database suite does not skip: run \`npm run verify:b2\`, ` +
        'which reports a missing or refused database as a failed gate.',
    );
  }
  return { uri: result.uri, databaseName: result.databaseName };
}

/**
 * Second line of defence, checked immediately before anything destructive
 * (deleteMany, dropIndex): the live connection must be to the database the
 * guard approved, by name, not merely to whatever the URI resolved to.
 */
export function assertConnectedToTestDatabase(connection, expectedName) {
  if (connection?.readyState !== 1 || connection.name !== expectedName) {
    throw new Error('Refusing a destructive test operation: not connected to the approved test database.');
  }
}
