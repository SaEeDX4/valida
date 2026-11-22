#!/usr/bin/env node
/**
 * D-3 — the live database's identity anchor (modules/admin/restoreRebaseline.js).
 *
 *   node --env-file=<env> scripts/db-identity.mjs init    once, at provisioning (owner)
 *   node --env-file=<env> scripts/db-identity.mjs check   read-only
 *
 * `init` records { setName, database } of MONGODB_URI's database as the live anchor,
 * insert-only. Run it with the same temporary owner-level user as
 * `npm run db:indexes:apply` (the API's runtime user can only read it). It refuses a
 * database that already carries ANOTHER identity: that database is a restore, which
 * opens its Admin only through `mongo-recovery.mjs restore-rebaseline`.
 *
 * `check` prints this database's identity and the Admin start-up verdict for
 * ADMIN_DATABASE_REPLICA_SET. One JSON line; never a URI or credential.
 * Exit: 0 done / OPEN; 1 refused or CLOSED; 2 usage.
 */
import mongoose from 'mongoose';
import { AdminRestoreRefused, adminStartupGate, databaseIdentity, initLiveAnchor } from '../src/modules/admin/restoreRebaseline.js';

const command = process.argv[2];
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
if (!['init', 'check'].includes(command)) {
  process.stderr.write('usage: db-identity.mjs init | check\n');
  process.exit(2);
}
const uri = process.env.MONGODB_URI;
if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) {
  process.stderr.write('db-identity: MONGODB_URI is required (a mongodb:// or mongodb+srv:// URI)\n');
  process.exit(2);
}
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: false, autoCreate: false });
  const db = mongoose.connection.db;
  if (command === 'init') {
    const { created, identity } = await initLiveAnchor(db);
    print({ command, created, identity });
  } else {
    const identity = await databaseIdentity(db);
    const gate = await adminStartupGate(db, { expectedReplicaSet: process.env.ADMIN_DATABASE_REPLICA_SET });
    print({ command, identity, admin: gate.open ? 'OPEN' : 'CLOSED', ...(gate.open ? { basis: gate.basis } : { reason: gate.reason }) });
    process.exitCode = gate.open ? 0 : 1;
  }
} catch (error) {
  if (error instanceof AdminRestoreRefused) {
    print({ command, refused: error.reason });
    process.exitCode = 1;
  } else {
    process.stderr.write(`db-identity ${command}: failed (${error?.name ?? 'Error'})\n`);
    process.exitCode = 1;
  }
} finally {
  await mongoose.disconnect().catch(() => {});
}
