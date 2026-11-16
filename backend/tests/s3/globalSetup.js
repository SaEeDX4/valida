import { startMoto } from './motoServer.js';

/** Starts the S3 test double once for the whole `npm run test:s3` run. */
export default async function setup({ provide }) {
  const moto = await startMoto();
  provide('moto', { endpoint: moto.endpoint, app: moto.app, denied: moto.denied, bucket: moto.bucket, otherBucket: moto.otherBucket });
  return async () => {
    await moto.stop();
  };
}
