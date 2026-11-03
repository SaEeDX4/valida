import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestCertificates } from './fixtures/testCertificates.js';
import { startLocalSmtpServer } from './fixtures/localSmtpServer.js';
import { createLedgerTransport, smokeMessageBudget } from '../scripts/smoke-ledger.mjs';
import { createOwnershipRecord, writeOwnershipRecord, smokeDatabaseTarget } from '../scripts/smoke-lifecycle.mjs';
// The run's storage naming contract, stated independently of scripts/smoke-lifecycle.mjs.
const smokeStoragePrefix = (runId) => `valida-smoke-storage-${runId}-`;

/**
 * B6 r4 — the opt-in live smoke script (scripts/notifications-smoke.mjs) as a
 * real process, offline: its refusals, its plan-only default and
 * --verify-only. The relay is the LOCAL SMTP TEST SERVER; the child trusts its
 * TEST CA only through Node's own NODE_EXTRA_CA_CERTS (an operator-level trust
 * ADDITION — verification itself cannot be switched off). Nothing here is
 * Titan evidence. The full live path is rehearsed against a real database in
 * tests/db/b6-smoke-rehearsal.test.js.
 */
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const USERNAME = 'notifications@qa-valida.example.test';
const PASSWORD = 'qa-smoke-password-marker-890';

let certificates;
let caFile;
let directory;
beforeAll(() => {
  certificates = createTestCertificates();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-smoke-test-'));
  caFile = path.join(directory, 'qa-test-ca.pem');
  fs.writeFileSync(caFile, certificates.ca);
});
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

const servers = [];
afterEach(async () => {
  while (servers.length) await servers.pop().stop();
});
async function relay(behaviour = {}) {
  const local = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD }, behaviour });
  servers.push(local);
  return local;
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/notifications-smoke.mjs', ...args], {
      cwd: backendRoot,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        NODE_EXTRA_CA_CERTS: caFile,
        MONGODB_URI: 'mongodb://127.0.0.1:1/valida_dev',
        MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_test',
        TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'localhost',
        SMTP_USERNAME: USERNAME,
        SMTP_PASSWORD: PASSWORD,
        TRANSACTIONAL_FROM_ADDRESS: USERNAME,
        TRANSACTIONAL_REPLY_TO: 'careers@qa-valida.example.test',
        RECRUITMENT_NOTIFICATION_RECIPIENT: 'recruitment@qa-valida.example.test',
        EMAIL_RECIPIENT_ALLOWLIST: '@qa-valida.example.test',
        ...env,
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ code, output }));
  });
}

describe('ops:notifications:smoke — refusals, plan and verify-only (LOCAL SMTP TEST SERVER — not Titan)', () => {
  it('is the npm script, reading backend/.env like npm start', () => {
    const packageJson = JSON.parse(fs.readFileSync(join(backendRoot, 'package.json'), 'utf8'));
    expect(packageJson.scripts['ops:notifications:smoke']).toBe('node --env-file-if-exists=.env scripts/notifications-smoke.mjs');
  });

  it('--verify-only: TLS + login against the relay; nothing sent; no database used; the password never printed', async () => {
    const local = await relay();
    const { code, output } = await run(['--verify-only'], { SMTP_PORT: String(local.port) });
    expect(code).toBe(0);
    expect(output).toMatch(/verify \(connect \+ TLS \+ login, nothing sent\): OK/);
    expect(output).toMatch(/VERIFY ONLY: .*No email was sent; no database was used\./);
    expect(output).toMatch(/not relay acceptance of a message, not delivery/);
    expect(local.record.authAttempts).toEqual([{ username: USERNAME, matched: true, secure: true }]);
    expect(local.record.messages).toHaveLength(0);
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(USERNAME);
  }, 30_000);

  it('without --confirm-live-email: the plan only, exit 2, nothing sent', async () => {
    const local = await relay();
    const { code, output } = await run(['--candidate-recipient', 'qa.inbox@qa-valida.example.test'], { SMTP_PORT: String(local.port) });
    expect(code).toBe(2);
    expect(output).toMatch(/PLAN ONLY: add --confirm-live-email to run it\. Nothing was sent\./);
    expect(output).toMatch(/1 acknowledgement\s+-> q\*\*\*@qa-valida\.example\.test/);
    expect(output).toMatch(/HARD LIMIT: at most 2 messages are submitted/);
    expect(output).toMatch(/the test server listens on 127\.0\.0\.1 only \(loopback\)/);
    expect(output).toMatch(/removed afterwards — the records first, then their resume files, each confirmed/);
    expect(local.record.messages).toHaveLength(0);

    const withBounce = await run(['--candidate-recipient', 'qa.inbox@qa-valida.example.test', '--bounce-recipient', 'qa.bounce@qa-valida.example.test'], { SMTP_PORT: String(local.port) });
    expect(withBounce.code).toBe(2);
    expect(withBounce.output).toMatch(/HARD LIMIT: at most 4 messages are submitted/);
    expect(local.record.messages).toHaveLength(0);
  }, 30_000);

  it('refused: production; a provider other than smtp; a recipient outside the allowlist; a non-test database; refused credentials (once, with guidance)', async () => {
    const local = await relay();
    const port = String(local.port);
    const production = await run(['--verify-only'], { SMTP_PORT: port, APP_ENV: 'production', NODE_ENV: 'production' });
    expect(production.code).toBe(1);
    expect(production.output).toMatch(/REFUSED: never run against a production environment/);

    const none = await run(['--verify-only'], { TRANSACTIONAL_EMAIL_PROVIDER: 'none', SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', TRANSACTIONAL_FROM_ADDRESS: '' });
    expect(none.code).toBe(1);
    expect(none.output).toMatch(/REFUSED: TRANSACTIONAL_EMAIL_PROVIDER is not "smtp"/);

    const outside = await run(['--candidate-recipient', 'someone@elsewhere.example.test', '--confirm-live-email'], { SMTP_PORT: port });
    expect(outside.code).toBe(1);
    expect(outside.output).toMatch(/REFUSED: --candidate-recipient is not covered by EMAIL_RECIPIENT_ALLOWLIST/);

    const appDatabase = await run(['--candidate-recipient', 'qa.inbox@qa-valida.example.test', '--confirm-live-email'], {
      SMTP_PORT: port,
      MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_dev',
    });
    expect(appDatabase.code).toBe(1);
    expect(appDatabase.output).toMatch(/REFUSED: .*\n.*A live run needs MONGODB_TEST_URI naming a dedicated test database/);

    const authAttemptsBefore = local.record.authAttempts.length;
    const refused = await run(['--candidate-recipient', 'qa.inbox@qa-valida.example.test', '--confirm-live-email'], { SMTP_PORT: port, SMTP_PASSWORD: 'qa-wrong-password-marker' });
    expect(refused.code).toBe(1);
    expect(refused.output).toMatch(/FAILED PROVIDER_AUTH_FAILED/);
    expect(refused.output).toMatch(/Do NOT retry repeatedly: Titan blocks an IP after repeated failures/);
    expect(refused.output).not.toContain('qa-wrong-password-marker');
    expect(local.record.authAttempts.length - authAttemptsBefore).toBe(1);
    expect(local.record.messages).toHaveLength(0);
  }, 60_000);
});

describe('the live smoke test\'s hard message budget (r4 review: bounded live message counts)', () => {
  const fakeReal = () => {
    const calls = [];
    return {
      calls,
      name: 'smtp',
      verify: async () => undefined,
      close: async () => undefined,
      async send(message) {
        calls.push(message.to[0]);
        if (message.to[0].startsWith('refused')) throw Object.assign(new Error('x'), { notificationCode: 'INVALID_RECIPIENT', notificationDiagnostic: { phase: 'envelope', replyCode: 550 } });
      },
    };
  };
  const message = (to) => ({ event: 'APPLICATION_RECEIVED_INTERNAL', to: [to] });

  it('is 2 for a plain run and 4 with the bounce test', () => {
    expect(smokeMessageBudget({ bounce: false })).toBe(2);
    expect(smokeMessageBudget({ bounce: true })).toBe(4);
  });

  it('hands at most `budget` submissions to the real transport; one more is refused BEFORE the relay, and reported', async () => {
    const real = fakeReal();
    const ledger = [];
    let refused = 0;
    const transport = createLedgerTransport({ real, budget: 2, ledger, describe: (m) => ({ to: m.to[0].slice(0, 1) }), onRefused: () => (refused += 1) });
    await transport.send(message('a@qa.example.test'), {});
    await expect(transport.send(message('refused@qa.example.test'), {})).rejects.toMatchObject({ notificationCode: 'INVALID_RECIPIENT' });
    await expect(transport.send(message('c@qa.example.test'), {})).rejects.toMatchObject({ code: 'SMOKE_BUDGET_REACHED' });
    await expect(transport.send(message('d@qa.example.test'), {})).rejects.toMatchObject({ code: 'SMOKE_BUDGET_REACHED' });
    expect(real.calls).toEqual(['a@qa.example.test', 'refused@qa.example.test']);
    expect(refused).toBe(2);
    expect(ledger).toEqual([
      { to: 'a', result: 'ACCEPTED_BY_RELAY' },
      { to: 'r', result: 'FAILED:INVALID_RECIPIENT', diagnostic: { phase: 'envelope', replyCode: 550 } },
    ]);
  });

  it('a refused submission carries no transport code: the service records it as uncertain, never retried automatically', async () => {
    const transport = createLedgerTransport({ real: fakeReal(), budget: 1, ledger: [{}], describe: () => ({}) });
    const error = await transport.send(message('a@qa.example.test'), {}).catch((caught) => caught);
    expect(error.notificationCode).toBeUndefined();
    expect(() => createLedgerTransport({ real: fakeReal(), budget: 0, ledger: [], describe: () => ({}) })).toThrow(TypeError);
  });
});

describe('ops:notifications:smoke --cleanup-run (r5): refusals, and files are never removed when the records are not confirmed gone', () => {
  it('needs a well-formed run id, alone; refuses production and a non-test database; sends nothing and needs no relay settings', async () => {
    const malformed = await run(['--cleanup-run', 'qa-smoke-*']);
    expect(malformed.code).toBe(2);
    expect(malformed.output).toMatch(/--cleanup-run needs the run id printed by the live run/);
    const combined = await run(['--cleanup-run', '0a1b2c3d', '--confirm-live-email']);
    expect(combined.code).toBe(2);
    expect(combined.output).toMatch(/--cleanup-run is used alone/);
    const production = await run(['--cleanup-run', '0a1b2c3d'], { APP_ENV: 'production', NODE_ENV: 'production' });
    expect(production.code).toBe(1);
    expect(production.output).toMatch(/REFUSED: never run against a production environment/);
    const appDatabase = await run(['--cleanup-run', '0a1b2c3d'], { MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_dev', TRANSACTIONAL_EMAIL_PROVIDER: 'none', SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', TRANSACTIONAL_FROM_ADDRESS: '' });
    expect(appDatabase.code).toBe(1);
    expect(appDatabase.output).toMatch(/REFUSED: .*\n.*--cleanup-run needs MONGODB_TEST_URI naming the dedicated test database/);
  }, 30_000);

  it('r6: no ownership record for the run (as for every run made before r6) -> REFUSED without touching the database; the files are kept', async () => {
    const temporary = fs.mkdtempSync(path.join(directory, 'tmp-'));
    const storage = fs.mkdtempSync(path.join(temporary, smokeStoragePrefix('0a1b2c3d')));
    fs.writeFileSync(path.join(storage, 'resume-object'), 'synthetic');
    const { code, output } = await run(['--cleanup-run', '0a1b2c3d'], { TMPDIR: temporary, TEMP: temporary, TMP: temporary, TRANSACTIONAL_EMAIL_PROVIDER: 'none', SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', TRANSACTIONAL_FROM_ADDRESS: '' });
    expect(code).toBe(1);
    expect(output).toMatch(/REFUSED \(OWNERSHIP_RECORD_MISSING\): no ownership record for this run/);
    expect(output).toMatch(/Nothing was deleted; every file was kept\./);
    expect(output).toMatch(/NOT TOUCHED: 1 director\(ies\) named valida-smoke-storage-0a1b2c3d-\*/);
    expect(fs.existsSync(path.join(storage, 'resume-object'))).toBe(true);
  }, 30_000);

  it('r6: a valid ownership record but an unreachable test database -> FAILED; the files are kept', async () => {
    const temporary = fs.mkdtempSync(path.join(directory, 'tmp-'));
    const storage = fs.mkdtempSync(path.join(temporary, smokeStoragePrefix('0a1b2c3d')));
    fs.writeFileSync(path.join(storage, 'resume-object'), 'synthetic');
    const record = createOwnershipRecord({ runId: '0a1b2c3d', target: smokeDatabaseTarget('mongodb://127.0.0.1:1/valida_test'), storageDirectory: path.basename(storage), jobId: '65f0c0ffee0000000000abcd' });
    writeOwnershipRecord(temporary, record);
    const { code, output } = await run(['--cleanup-run', '0a1b2c3d'], { TMPDIR: temporary, TEMP: temporary, TMP: temporary, TRANSACTIONAL_EMAIL_PROVIDER: 'none', SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', TRANSACTIONAL_FROM_ADDRESS: '' });
    expect(code).toBe(1);
    expect(output).toMatch(/FAILED: the test database could not be used/);
    expect(output).toMatch(/every file was kept/);
    expect(fs.existsSync(path.join(storage, 'resume-object'))).toBe(true);
  }, 30_000);
});
