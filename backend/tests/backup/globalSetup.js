import { startBackupMoto } from './backupFixture.js';

/** Starts the backup double once for the whole `npm run test:backup` run. */
export default async function setup({ provide }) {
  const moto = await startBackupMoto();
  provide('backupMoto', { endpoint: moto.endpoint, users: moto.users, buckets: moto.buckets });
  return async () => {
    await moto.stop();
  };
}
