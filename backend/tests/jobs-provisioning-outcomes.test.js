import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseJobDefinition, provisionJob } from '../src/modules/jobs/job.provisioning.js';
import { createFakeJobModel } from './fixtures/fakeJobStore.js';
import { QA_NOW, at, minutes, syntheticDefinition } from './fixtures/jobFixtures.js';

/**
 * Provisioning — effective lifecycle confirmation and truthful outcomes.
 * B3 correction cycle 1, findings 1 and 2.
 *
 * OFFLINE, WITH A STAND-IN COLLECTION (tests/fixtures/fakeJobStore.js): the
 * real provisioning module, B2 services and Job model run unchanged; only the
 * collection methods underneath are replaced, so the tests can count the
 * writes a run sends and inject a failure at an exact point. This is not
 * persistence evidence — tests/db/job-provisioning.test.js covers the same
 * lifecycle behaviour against a real MongoDB.
 */

const definition = (overrides) => {
  const parsed = parseJobDefinition(syntheticDefinition(overrides));
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.definition;
};

const SLUG = 'qa-synthetic-provisioned-role';
const codes = (result) => result.refusals.map((refusal) => refusal.code);

/** A stand-in store plus a runner bound to it. */
function harness(options) {
  const fake = createFakeJobModel(options);
  const run = (overrides, now, flags = {}) =>
    provisionJob({
      definition: definition(overrides),
      apply: true,
      now,
      model: fake.model,
      applicationModel: fake.applicationModel,
      ...flags,
    });
  const plan = (overrides, now) =>
    provisionJob({
      definition: definition(overrides),
      apply: false,
      now,
      model: fake.model,
      applicationModel: fake.applicationModel,
    });
  return { ...fake, run, plan };
}

/** A PUBLISHED Job, first published two hours before QA_NOW. */
async function publishedAt2hAgo(h, closesAt) {
  const created = await h.run(
    { status: 'PUBLISHED', closesAt: closesAt ? closesAt.toISOString() : null },
    at(-minutes(120)),
    { confirmLifecycle: true },
  );
  expect(created.outcome).toBe('created');
  return h.store.stored(SLUG);
}

describe('finding 1 — an edit that changes the effective public state needs confirmation', () => {
  it('reproduction: an expired PUBLISHED Job reopened by clearing closesAt is refused with ZERO writes', async () => {
    const h = harness();
    const before = await publishedAt2hAgo(h, at(-minutes(1)));
    const writesBefore = h.store.writeCalls;

    const result = await h.run({ status: 'PUBLISHED', closesAt: null }, QA_NOW);
    expect(result.outcome).toBe('refused');
    expect(codes(result)).toEqual(['LIFECYCLE_CONFIRMATION_REQUIRED']);
    expect(result.refusals[0].message).toMatch(/public effect CLOSED -> OPEN \(closesAt\)/);
    expect(result.plan.transition).toBeNull();
    expect(result.plan.effectiveChange).toEqual({ from: 'CLOSED', to: 'OPEN', cause: 'closesAt' });
    expect(result.plan.requiresConfirmation.lifecycle).toBe(true);
    expect(result.writes).toEqual([]);
    expect(h.store.writeCalls).toBe(writesBefore);
    expect(h.store.stored(SLUG)).toEqual(before);
  });

  it('the same reopening succeeds with --confirm-lifecycle: one update, first publication kept', async () => {
    const h = harness();
    const before = await publishedAt2hAgo(h, at(-minutes(1)));
    const writesBefore = h.store.writeCalls;

    const result = await h.run({ status: 'PUBLISHED', closesAt: null }, QA_NOW, { confirmLifecycle: true });
    expect(result.outcome).toBe('updated');
    expect(h.store.writeCalls - writesBefore).toBe(1);
    expect(result.job).toMatchObject({ status: 'PUBLISHED', closesAt: null, publicNow: 'OPEN' });
    expect(h.store.stored(SLUG).publishedAt.getTime()).toBe(before.publishedAt.getTime());
  });

  it('the inverse: an OPEN Job closed by a past closesAt is refused with zero writes, then applied when confirmed', async () => {
    const h = harness();
    await publishedAt2hAgo(h, null);
    const writesBefore = h.store.writeCalls;

    const past = at(-minutes(1)).toISOString();
    const refused = await h.run({ status: 'PUBLISHED', closesAt: past }, QA_NOW);
    expect(codes(refused)).toEqual(['LIFECYCLE_CONFIRMATION_REQUIRED']);
    expect(refused.plan.effectiveChange).toEqual({ from: 'OPEN', to: 'CLOSED', cause: 'closesAt' });
    expect(h.store.writeCalls).toBe(writesBefore);
    expect(h.store.stored(SLUG).closesAt).toBeNull();

    const confirmed = await h.run({ status: 'PUBLISHED', closesAt: past }, QA_NOW, { confirmLifecycle: true });
    expect(confirmed.outcome).toBe('updated');
    expect(confirmed.job).toMatchObject({ status: 'PUBLISHED', publicNow: 'CLOSED' });
    expect(h.store.writeCalls - writesBefore).toBe(1);
  });

  it('boundary: closesAt exactly now closes the Job and needs confirmation', async () => {
    const h = harness();
    await publishedAt2hAgo(h, null);
    const writesBefore = h.store.writeCalls;
    const result = await h.run({ status: 'PUBLISHED', closesAt: QA_NOW.toISOString() }, QA_NOW);
    expect(codes(result)).toEqual(['LIFECYCLE_CONFIRMATION_REQUIRED']);
    expect(result.plan.effectiveChange).toEqual({ from: 'OPEN', to: 'CLOSED', cause: 'closesAt' });
    expect(h.store.writeCalls).toBe(writesBefore);
  });

  it('boundary: closesAt 1 ms after now only schedules a close — the Job stays OPEN, no confirmation', async () => {
    const h = harness();
    await publishedAt2hAgo(h, null);
    const writesBefore = h.store.writeCalls;
    const result = await h.run({ status: 'PUBLISHED', closesAt: at(1).toISOString() }, QA_NOW);
    expect(result.outcome).toBe('updated');
    expect(result.plan.effectiveChange).toBeNull();
    expect(result.plan.requiresConfirmation.lifecycle).toBe(false);
    expect(result.job.publicNow).toBe('OPEN');
    expect(h.store.writeCalls - writesBefore).toBe(1);
  });

  it('boundary: moving a passed closing time to 1 ms after now reopens the Job and needs confirmation', async () => {
    const h = harness();
    await publishedAt2hAgo(h, at(-minutes(1)));
    const result = await h.run({ status: 'PUBLISHED', closesAt: at(1).toISOString() }, QA_NOW);
    expect(codes(result)).toEqual(['LIFECYCLE_CONFIRMATION_REQUIRED']);
    expect(result.plan.effectiveChange).toEqual({ from: 'CLOSED', to: 'OPEN', cause: 'closesAt' });
  });

  it('an already-expired Job re-applied unchanged is a no-op: no confirmation, no write', async () => {
    const h = harness();
    await publishedAt2hAgo(h, at(-minutes(60)));
    const writesBefore = h.store.writeCalls;
    const result = await h.run({ status: 'PUBLISHED', closesAt: at(-minutes(60)).toISOString() }, QA_NOW);
    expect(result.outcome).toBe('unchanged');
    expect(result.plan).toMatchObject({ effectiveChange: null, publicBefore: 'CLOSED', publicAfter: 'CLOSED' });
    expect(result.plan.requiresConfirmation.lifecycle).toBe(false);
    expect(h.store.writeCalls).toBe(writesBefore);
  });

  it('the passage of time alone never requires confirmation: OPEN at one run, expired by the next, still unchanged', async () => {
    const h = harness();
    const closesAt = at(-minutes(30)).toISOString(); // in the future when published, past at QA_NOW
    await publishedAt2hAgo(h, new Date(closesAt));
    const earlier = await h.plan({ status: 'PUBLISHED', closesAt }, at(-minutes(60)));
    expect(earlier.plan).toMatchObject({ action: 'unchanged', publicBefore: 'OPEN', effectiveChange: null });
    const writesBefore = h.store.writeCalls;

    const later = await h.run({ status: 'PUBLISHED', closesAt }, QA_NOW);
    expect(later.outcome).toBe('unchanged');
    expect(later.plan).toMatchObject({ publicBefore: 'CLOSED', publicAfter: 'CLOSED', effectiveChange: null });
    expect(h.store.writeCalls).toBe(writesBefore);
  });

  it('a content edit on an expired Job that leaves it CLOSED needs no lifecycle confirmation', async () => {
    const h = harness();
    await publishedAt2hAgo(h, at(-minutes(1)));
    const result = await h.run(
      { status: 'PUBLISHED', closesAt: at(-minutes(1)).toISOString(), title: 'QA Synthetic Retitled Role' },
      QA_NOW,
    );
    expect(result.outcome).toBe('updated');
    expect(result.plan.effectiveChange).toBeNull();
  });

  it('plan mode reports the effective change and the confirmation it needs, and writes nothing', async () => {
    const h = harness();
    await publishedAt2hAgo(h, null);
    const writesBefore = h.store.writeCalls;
    const result = await h.plan({ status: 'PUBLISHED', closesAt: at(-1).toISOString() }, QA_NOW);
    expect(result.outcome).toBe('planned');
    expect(result.plan).toMatchObject({
      effectiveChange: { from: 'OPEN', to: 'CLOSED', cause: 'closesAt' },
      requiresConfirmation: { lifecycle: true },
    });
    expect(h.store.writeCalls).toBe(writesBefore);
  });

  it('a stored transition still reports its public effect and still needs confirmation', async () => {
    const h = harness();
    await publishedAt2hAgo(h, null);
    const result = await h.run({ status: 'CLOSED' }, QA_NOW);
    expect(codes(result)).toEqual(['LIFECYCLE_CONFIRMATION_REQUIRED']);
    expect(result.plan.effectiveChange).toEqual({ from: 'OPEN', to: 'CLOSED', cause: 'lifecycle transition' });
  });
});

describe('finding 2 — outcomes state only what is established (in-process fault injection)', () => {
  const publishDefinition = { status: 'PUBLISHED' };

  it('insert acknowledged, publication REJECTED: incomplete — DRAFT kept, never "refused"', async () => {
    const h = harness({ faults: { updateOne: () => ({ result: { acknowledged: true, matchedCount: 0, modifiedCount: 0 } }) } });
    const result = await h.run(publishDefinition, QA_NOW, { confirmLifecycle: true });
    expect(result.outcome).toBe('incomplete');
    expect(result.writes).toEqual([`created "${SLUG}" as DRAFT`]);
    expect(result.failure).toMatchObject({ step: 'publish it (DRAFT -> PUBLISHED)', applied: 'no' });
    expect(result.failure.detail.map((detail) => detail.code)).toEqual(['JOB_CHANGED_CONCURRENTLY']);
    expect(result.readback).toBe('confirmed');
    expect(result.job).toMatchObject({ status: 'DRAFT', publishedAt: null });
    expect(h.store.stored(SLUG).status).toBe('DRAFT');
    expect(h.store.calls.delete).toBe(0); // nothing rolled back
  });

  it('insert acknowledged, publication UNACKNOWLEDGED: unconfirmed, publication outcome unknown', async () => {
    const h = harness({
      faults: {
        updateOne: () => {
          throw new mongoose.mongo.MongoNetworkError('reset mongodb://secret@db');
        },
      },
    });
    const result = await h.run(publishDefinition, QA_NOW, { confirmLifecycle: true });
    expect(result.outcome).toBe('unconfirmed');
    expect(result.writes).toEqual([`created "${SLUG}" as DRAFT`]);
    expect(result.failure).toMatchObject({ applied: 'unknown' });
    expect(JSON.stringify(result.failure)).not.toMatch(/secret|mongodb:\/\//);
    expect(h.store.calls.delete).toBe(0);
  });

  it('insert acknowledged, READ-BACK fails: unconfirmed with the write listed — never "nothing was written"', async () => {
    const h = harness({
      faults: {
        findOne: (call) => {
          if (call >= 2) throw new mongoose.Error.MongooseServerSelectionError('selection timed out');
        },
      },
    });
    const result = await h.run({}, QA_NOW);
    expect(result.outcome).toBe('unconfirmed');
    expect(result.writes).toEqual([`created "${SLUG}" as DRAFT`]);
    expect(result.failure).toBeNull();
    expect(result.readback).toBe('failed');
    expect(h.store.stored(SLUG)).not.toBeNull();
  });

  it('insert UNACKNOWLEDGED: unconfirmed, nothing claimed either way', async () => {
    const h = harness({
      faults: {
        insertOne: () => {
          throw new mongoose.mongo.MongoNetworkError('reset');
        },
      },
    });
    const result = await h.run({}, QA_NOW);
    expect(result.outcome).toBe('unconfirmed');
    expect(result.writes).toEqual([]);
    expect(result.failure).toMatchObject({ step: `create "${SLUG}" as DRAFT`, applied: 'unknown' });
  });

  it('a duplicate-key rejection of the only write: refused — nothing was written', async () => {
    const h = harness({
      faults: {
        insertOne: () => {
          const error = new mongoose.mongo.MongoServerError({ message: 'E11000' });
          error.code = 11000;
          throw error;
        },
      },
    });
    const result = await h.run({}, QA_NOW);
    expect(result.outcome).toBe('refused');
    expect(codes(result)).toEqual(['DUPLICATE_SLUG']);
    expect(result.failure).toMatchObject({ applied: 'no' });
    expect(h.store.docs.size).toBe(0);
  });

  it('an update that matched nothing: refused — nothing was written', async () => {
    const h = harness();
    await h.run({}, at(-minutes(10)));
    h.model.collection.updateOne = async () => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0 });
    const result = await h.run({ title: 'QA Synthetic Retitled Role' }, QA_NOW);
    expect(result.outcome).toBe('refused');
    expect(codes(result)).toEqual(['JOB_CHANGED_CONCURRENTLY']);
    expect(h.store.stored(SLUG).title).toBe('QA Synthetic Provisioned Role');
  });

  it('an unacknowledged update: unconfirmed, not "refused"', async () => {
    const h = harness();
    await h.run({}, at(-minutes(10)));
    h.model.collection.updateOne = async () => {
      throw new mongoose.mongo.MongoNetworkError('reset');
    };
    const result = await h.run({ title: 'QA Synthetic Retitled Role' }, QA_NOW);
    expect(result.outcome).toBe('unconfirmed');
    expect(result.failure).toMatchObject({ applied: 'unknown' });
  });

  it('throws only in the read phase, before any write is attempted', async () => {
    const h = harness({
      faults: {
        findOne: () => {
          throw new mongoose.Error.MongooseServerSelectionError('selection timed out');
        },
      },
    });
    await expect(h.run({}, QA_NOW)).rejects.toThrow();
    expect(h.store.writeCalls).toBe(0);
  });

  it('a normal create reports its writes and a confirmed read-back', async () => {
    const h = harness();
    const result = await h.run(publishDefinition, QA_NOW, { confirmLifecycle: true });
    expect(result).toMatchObject({
      outcome: 'created',
      writes: [`created "${SLUG}" as DRAFT`, 'published it (DRAFT -> PUBLISHED)'],
      failure: null,
      readback: 'confirmed',
    });
  });
});

describe('finding 2 — the actual CLI output and exit code (offline fault injection)', () => {
  const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const preload = pathToFileURL(join(backendRoot, 'tests', 'fixtures', 'provision-cli-fault-preload.mjs')).href;

  /** Runs the unmodified CLI with the stand-in database adapter preloaded. */
  function cli(scenario, raw, args) {
    const dir = mkdtempSync(join(tmpdir(), 'valida-b3-faults-'));
    try {
      const file = join(dir, 'qa-definition.json');
      writeFileSync(file, JSON.stringify(raw));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^MONGODB_/i.test(key)));
      const result = spawnSync(
        process.execPath,
        ['--import', preload, 'scripts/provision-job.mjs', ...args(file)],
        {
          cwd: backendRoot,
          env: {
            ...env,
            APP_ENV: 'local',
            NODE_ENV: 'test',
            MONGODB_URI: 'mongodb://127.0.0.1:1/valida_offline_standin',
            VALIDA_TEST_PROVISION_FAULT: scenario,
          },
          encoding: 'utf8',
          timeout: 60_000,
        },
      );
      return { code: result.status, output: `${result.stdout}${result.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const apply = (...flags) => (file) => ['apply', '--file', file, ...flags];
  const noSecrets = (output) => {
    expect(output).not.toMatch(/stand-in-secret|mongodb:\/\//);
    expect(output).not.toMatch(/\n\s+at /); // no stack trace
  };

  it('control: with no fault the CLI reports CREATED and exits 0', () => {
    const { code, output } = cli('none', syntheticDefinition(), apply());
    expect(code).toBe(0);
    expect(output).toMatch(/written\s+: created "qa-synthetic-provisioned-role" as DRAFT/);
    expect(output).toMatch(/result\s+: CREATED/);
  }, 60_000);

  it('insert acknowledged, publication rejected: INCOMPLETE, lists the DRAFT it created, exit 1', () => {
    const { code, output } = cli('publish-rejected', syntheticDefinition({ status: 'PUBLISHED' }), apply('--confirm-lifecycle'));
    expect(code).toBe(1);
    expect(output).toMatch(/written\s+: created "qa-synthetic-provisioned-role" as DRAFT/);
    expect(output).toMatch(/failed step\s+: publish it \(DRAFT -> PUBLISHED\) — NOT applied/);
    expect(output).toMatch(/status\s+: DRAFT/);
    expect(output).toMatch(/result\s+: INCOMPLETE/);
    expect(output).toMatch(/Nothing was rolled back or deleted/);
    expect(output).not.toMatch(/nothing was written/i);
    noSecrets(output);
  }, 60_000);

  it('insert acknowledged, publication unacknowledged: NOT CONFIRMED, outcome unknown, exit 1', () => {
    const { code, output } = cli('publish-unknown', syntheticDefinition({ status: 'PUBLISHED' }), apply('--confirm-lifecycle'));
    expect(code).toBe(1);
    expect(output).toMatch(/written\s+: created "qa-synthetic-provisioned-role" as DRAFT/);
    expect(output).toMatch(/outcome UNKNOWN/);
    expect(output).toMatch(/result\s+: NOT CONFIRMED — the database did not confirm whether the failed step was applied/);
    expect(output).toMatch(/confirmation\s+: required — --confirm-lifecycle given/);
    expect(output).not.toMatch(/nothing was written/i);
    noSecrets(output);
  }, 60_000);

  it('insert acknowledged, read-back fails: NOT CONFIRMED with the write listed, exit 1', () => {
    const { code, output } = cli('readback-fails', syntheticDefinition(), apply());
    expect(code).toBe(1);
    expect(output).toMatch(/written\s+: created "qa-synthetic-provisioned-role" as DRAFT/);
    expect(output).toMatch(/stored state\s+: could NOT be read back/);
    expect(output).toMatch(/result\s+: NOT CONFIRMED — the writes listed above were acknowledged/);
    expect(output).toMatch(/next step\s+: Nothing was rolled back or deleted\. Run the same `plan` command/);
    expect(output).not.toMatch(/nothing was written/i);
    noSecrets(output);
  }, 60_000);

  it('insert unacknowledged: NOT CONFIRMED, claims nothing either way, exit 1', () => {
    const { code, output } = cli('insert-unknown', syntheticDefinition(), apply());
    expect(code).toBe(1);
    expect(output).toMatch(/written\s+: nothing acknowledged by the database/);
    expect(output).toMatch(/outcome UNKNOWN/);
    expect(output).toMatch(/result\s+: NOT CONFIRMED/);
    expect(output).not.toMatch(/nothing was written/i);
    noSecrets(output);
  }, 60_000);

  it('a failure while reading, before any write: says nothing was written — which is established — exit 1', () => {
    const { code, output } = cli('read-fails', syntheticDefinition(), apply());
    expect(code).toBe(1);
    expect(output).toMatch(/failed while reading the stored Job, before any write/);
    expect(output).toMatch(/Nothing was written/);
    noSecrets(output);
  }, 60_000);

  it('the result stands when only closing the connection fails afterwards, exit 1', () => {
    const { code, output } = cli('disconnect-fails', syntheticDefinition(), apply());
    expect(code).toBe(1);
    expect(output).toMatch(/result\s+: CREATED/);
    expect(output).toMatch(/did not close cleanly\. The result above stands/);
    expect(output).not.toMatch(/nothing was written/i);
    noSecrets(output);
  }, 60_000);

  it('a failure while reporting, after the write phase: claims nothing about writes, exit 1', () => {
    const { code, output } = cli('report-fails', syntheticDefinition(), apply());
    expect(code).toBe(1);
    expect(output).toMatch(/failed while reporting its result/);
    expect(output).toMatch(/Writes may have been made — do not assume either way/);
    expect(output).not.toMatch(/nothing was written/i);
    noSecrets(output);
  }, 60_000);

  it('a refusal before any write still says nothing was written, exit 1', () => {
    const { code, output } = cli('none', syntheticDefinition({ status: 'PUBLISHED' }), apply());
    expect(code).toBe(1);
    expect(output).toMatch(/LIFECYCLE_CONFIRMATION_REQUIRED/);
    expect(output).toMatch(/confirmation\s+: required — --confirm-lifecycle NOT given/);
    expect(output).toMatch(/result\s+: REFUSED — nothing was written/);
  }, 60_000);

  it('the preload cannot activate without its explicit test variable', () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'VALIDA_TEST_PROVISION_FAULT'));
    const result = spawnSync(process.execPath, ['--import', preload, '-e', ''], { cwd: backendRoot, env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}`).toMatch(/requires VALIDA_TEST_PROVISION_FAULT/);
  }, 60_000);
});
