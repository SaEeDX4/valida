/**
 * TEST CHILD PROCESS — stores one synthetic resume in local private storage
 * and exits, printing only the returned metadata as JSON.
 *
 * Used by tests/private-storage.test.js to prove that a stored object
 * survives the process that wrote it and is found by a NEW process with a
 * NEW adapter instance (Doc 18 section 121: object persisted).
 *
 *   node storage-child.mjs <storageRoot> <sourceFile> <sha256> <sizeBytes>
 */
import { LocalPrivateStorage } from '../../src/integrations/storage/localPrivateStorage.js';

const [storageRoot, sourceFile, checksumSha256, sizeBytes] = process.argv.slice(2);
const storage = new LocalPrivateStorage({ root: storageRoot, appEnv: 'local', nodeEnv: 'test' });
await storage.init();
const stored = await storage.storePrivateResume({
  filePath: sourceFile,
  checksumSha256,
  sizeBytes: Number(sizeBytes),
});
await storage.close();
process.stdout.write(`${JSON.stringify({ ...stored, pid: process.pid })}\n`);
