import { describe, it, expect } from 'vitest';
import { ConfigurationError, loadConfig } from '../src/config/env.js';
import { createPrivateStorage } from '../src/integrations/storage/privateStorage.js';
import { MongoPrivateStorage } from '../src/integrations/storage/mongoPrivateStorage.js';
import { OFFLINE_TEST_MONGODB_URI, silentLogger } from './helpers.js';

/**
 * Proposed (MongoDB-native) — OFFLINE configuration rules for the MongoDB
 * résumé store. No database is contacted. Synthetic values only.
 */
const STORAGE_URI = 'mongodb://qa-storage-user:qa-unit-password@127.0.0.1:27017/valida_test';
const base = { NODE_ENV: 'test', APP_ENV: 'local', MONGODB_URI: OFFLINE_TEST_MONGODB_URI };
const failureOf = (env) => {
  try {
    loadConfig(env);
  } catch (error) {
    return error;
  }
  return null;
};
const variables = (error) => (error?.issues ?? []).map((i) => `${i.variable}: ${i.rule}`);

describe('RESUME_STORAGE_DRIVER=mongodb configuration', () => {
  it('accepts the driver with its own URI, and the URI never serialises', () => {
    const config = loadConfig({ ...base, RESUME_STORAGE_DRIVER: 'mongodb', RESUME_STORAGE_MONGODB_URI: STORAGE_URI });
    expect(config.resumeStorage.driver).toBe('mongodb');
    expect(config.resumeStorage.mongodb.uri).toBe(STORAGE_URI);
    const serialised = JSON.stringify(config);
    expect(serialised).not.toContain('qa-unit-password');
    expect(serialised).not.toContain('qa-storage-user');
  });

  it('refuses the driver without RESUME_STORAGE_MONGODB_URI', () => {
    const error = failureOf({ ...base, RESUME_STORAGE_DRIVER: 'mongodb' });
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(variables(error).join('\n')).toMatch(/RESUME_STORAGE_MONGODB_URI: is required when RESUME_STORAGE_DRIVER=mongodb/);
  });

  it('refuses RESUME_STORAGE_MONGODB_URI without the mongodb driver (no silent fallback to local storage)', () => {
    const error = failureOf({ ...base, RESUME_STORAGE_MONGODB_URI: STORAGE_URI });
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(variables(error).join('\n')).toMatch(/RESUME_STORAGE_MONGODB_URI: is set but RESUME_STORAGE_DRIVER is not "mongodb"/);
  });

  it('refuses a non-MongoDB URI', () => {
    const error = failureOf({ ...base, RESUME_STORAGE_DRIVER: 'mongodb', RESUME_STORAGE_MONGODB_URI: 'https://example.test/x' });
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(variables(error).some((v) => v.startsWith('RESUME_STORAGE_MONGODB_URI'))).toBe(true);
  });

  it('in production, refuses the storage credential when it equals MONGODB_URI (least privilege)', () => {
    const shared = 'mongodb+srv://qa-shared:qa-unit-password@qa-cluster.example.test/valida';
    const error = failureOf({ APP_ENV: 'production', NODE_ENV: 'production', MONGODB_URI: shared, RESUME_STORAGE_DRIVER: 'mongodb', RESUME_STORAGE_MONGODB_URI: shared });
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(variables(error).join('\n')).toMatch(/RESUME_STORAGE_MONGODB_URI: must not equal MONGODB_URI in production/);
    expect(error.message).not.toContain('qa-unit-password');
  });

  it('createPrivateStorage builds the MongoDB store for the mongodb driver (no connection until init)', () => {
    const config = loadConfig({ ...base, RESUME_STORAGE_DRIVER: 'mongodb', RESUME_STORAGE_MONGODB_URI: STORAGE_URI });
    const storage = createPrivateStorage({ config, logger: silentLogger() });
    expect(storage).toBeInstanceOf(MongoPrivateStorage);
  });
});
