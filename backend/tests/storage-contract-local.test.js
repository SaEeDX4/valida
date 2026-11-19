import fs from 'node:fs';
import path from 'node:path';
import { afterAll } from 'vitest';
import { LocalPrivateStorage } from '../src/integrations/storage/localPrivateStorage.js';
import { defineStorageContract } from './fixtures/storageContract.shared.js';
import { makeTestRoot, removeTestRoot } from './fixtures/uploadHarness.js';

/**
 * C6-T4 — the shared B4 storage contract (fixtures/storageContract.shared.js),
 * run against the accepted B4 local driver on the real filesystem. The same
 * suite runs against the S3-compatible driver in tests/s3/.
 */
let root = null;
const roots = [];
afterAll(() => {
  for (const r of roots) removeTestRoot(r);
});

defineStorageContract('local driver (LOCAL_DEVELOPMENT)', {
  reset: async () => {
    root = makeTestRoot();
    roots.push(root);
  },
  create: async () => new LocalPrivateStorage({ root: path.join(root, 'store'), appEnv: 'local', nodeEnv: 'test' }),
  readBack: async (_storage, key) => {
    const file = path.join(root, 'store', ...key.split('/'));
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  },
});
