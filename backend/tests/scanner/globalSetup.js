import net from 'node:net';
import { checkTestDatabaseTarget } from '../../scripts/test-database.mjs';

/** Refuses the run unless the real clamd answers VERSION and the database is a disposable test database. */
export default async function requireScannerAndDatabase() {
  const db = checkTestDatabaseTarget({ env: process.env });
  if (!db.ok) throw new Error(`[test:scanner] ${db.reason}`);
  const host = process.env.CLAMD_TEST_HOST ?? '127.0.0.1';
  const port = Number(process.env.CLAMD_TEST_PORT ?? 3310);
  const answer = await new Promise((resolve) => {
    const s = net.connect({ host, port });
    const chunks = [];
    const t = setTimeout(() => { s.destroy(); resolve(null); }, 5000);
    s.on('connect', () => s.write('zVERSION\0'));
    s.on('data', (d) => chunks.push(d));
    s.on('close', () => { clearTimeout(t); resolve(Buffer.concat(chunks).toString('utf8')); });
    s.on('error', () => { clearTimeout(t); resolve(null); });
  });
  if (!answer || !answer.startsWith('ClamAV ')) {
    throw new Error(`[test:scanner] the real clamd at ${host}:${port} did not answer VERSION — the scanner suite does not skip`);
  }
}
