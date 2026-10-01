import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadConfig, ConfigurationError, checkLocalStorageRoot, APPLICATION_ROOT } from '../src/config/env.js';

/**
 * B4 — private storage configuration (Doc 09 section 107, Doc 15 sections
 * 38, 49-58, 76-77 and 97-103).
 *
 * The development-only local driver must be refused by any deployed or
 * production-mode configuration, its root must be a safe private location,
 * and no failure message may echo the path.
 */
const base = { NODE_ENV: 'development', APP_ENV: 'local', MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_dev' };
const production = { NODE_ENV: 'production', APP_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://valida.example', MONGODB_URI: 'mongodb://127.0.0.1:27017/valida' };
const privateRoot = path.resolve(APPLICATION_ROOT, '..', 'valida-private-storage-qa');

const failureOf = (env) => {
  try {
    loadConfig(env);
  } catch (error) {
    return error;
  }
  return null;
};

describe('storage is optional, and absent means absent', () => {
  it('no storage variables -> driver null (the service still starts; readiness reports it)', () => {
    expect(loadConfig(base).resumeStorage).toEqual({ driver: null, localRoot: null });
    expect(loadConfig(production).resumeStorage).toEqual({ driver: null, localRoot: null });
  });

  it('empty values copied from a template are treated as unset', () => {
    expect(loadConfig({ ...base, RESUME_STORAGE_DRIVER: '', RESUME_STORAGE_LOCAL_ROOT: '' }).resumeStorage.driver).toBeNull();
  });

  it('the local driver with a valid root is accepted for local development', () => {
    const config = loadConfig({ ...base, RESUME_STORAGE_DRIVER: 'local', RESUME_STORAGE_LOCAL_ROOT: privateRoot });
    expect(config.resumeStorage).toEqual({ driver: 'local', localRoot: privateRoot });
  });

  it('the root is never serialised', () => {
    const config = loadConfig({ ...base, RESUME_STORAGE_DRIVER: 'local', RESUME_STORAGE_LOCAL_ROOT: privateRoot });
    expect(JSON.stringify(config)).not.toContain(privateRoot);
    expect(JSON.parse(JSON.stringify(config)).resumeStorage).toEqual({ driver: 'local', localRoot: '[redacted]' });
  });
});

describe('production rejects development storage (Doc 09 section 107)', () => {
  it.each([
    ['APP_ENV=production', production],
    ['APP_ENV=review', { ...production, APP_ENV: 'review' }],
    ['NODE_ENV=production with APP_ENV=local', { ...base, NODE_ENV: 'production' }],
  ])('refuses RESUME_STORAGE_DRIVER=local under %s', (_label, env) => {
    const error = failureOf({ ...env, RESUME_STORAGE_DRIVER: 'local', RESUME_STORAGE_LOCAL_ROOT: privateRoot });
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.issues.map((issue) => issue.variable)).toContain('RESUME_STORAGE_DRIVER');
    expect(error.message).toMatch(/development-only/);
    expect(error.message).not.toContain(privateRoot);
  });

  it.each(['s3', 'LOCAL', 'filesystem', 'memory'])('refuses the unknown driver %j', (driver) => {
    const error = failureOf({ ...base, RESUME_STORAGE_DRIVER: driver });
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toContain('RESUME_STORAGE_DRIVER: must be "local" (development only) or left unset');
    // The rejected value itself is never repeated back.
    expect(error.message).not.toContain(driver);
  });

  it('refuses a root without the driver (a half configuration)', () => {
    const error = failureOf({ ...base, RESUME_STORAGE_LOCAL_ROOT: privateRoot });
    expect(error.issues).toEqual([{ variable: 'RESUME_STORAGE_LOCAL_ROOT', rule: expect.stringMatching(/set both, or neither/) }]);
  });

  it('refuses the driver without a root', () => {
    const error = failureOf({ ...base, RESUME_STORAGE_DRIVER: 'local' });
    expect(error.issues).toEqual([{ variable: 'RESUME_STORAGE_LOCAL_ROOT', rule: 'is required when RESUME_STORAGE_DRIVER=local' }]);
  });
});

describe('local root rules — POSIX paths', () => {
  const check = (value, applicationRoot = '/home/qa/valida') =>
    checkLocalStorageRoot(value, { pathApi: path.posix, applicationRoot });

  it.each([
    ['/var/lib/valida-private', null],
    ['/home/qa/valida-private-storage', null],
    ['relative/storage', 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE'],
    ['./storage', 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE'],
    ['/', 'RESUME_STORAGE_LOCAL_ROOT_FILESYSTEM_ROOT'],
    ['/srv/www/resumes', 'RESUME_STORAGE_LOCAL_ROOT_PUBLIC_DIRECTORY'],
    ['/srv/app/public/uploads', 'RESUME_STORAGE_LOCAL_ROOT_PUBLIC_DIRECTORY'],
    ['/srv/app/Static/resumes', 'RESUME_STORAGE_LOCAL_ROOT_PUBLIC_DIRECTORY'],
    ['/srv/app/dist', 'RESUME_STORAGE_LOCAL_ROOT_PUBLIC_DIRECTORY'],
    ['/var/www/html', 'RESUME_STORAGE_LOCAL_ROOT_PUBLIC_DIRECTORY'],
    ['/home/qa/valida/backend/private', 'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION'],
    ['/home/qa/valida', 'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION'],
    ['/home/qa', 'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION'],
    ['/home/qa/valida/../valida/frontend/x', 'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION'],
    ['', 'RESUME_STORAGE_LOCAL_ROOT_REQUIRED'],
    ['/tmp/a\nb', 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE'],
  ])('%j -> %s', (value, expected) => {
    expect(check(value)).toBe(expected);
  });
});

describe('local root rules — Windows paths (checked with path.win32 on any platform)', () => {
  const check = (value, applicationRoot = 'C:\\ME\\valida') =>
    checkLocalStorageRoot(value, { pathApi: path.win32, applicationRoot });

  it.each([
    ['C:\\valida-data\\private-resumes', null],
    ['D:\\ValidaPrivate', null],
    ['C:/valida-data/private-resumes', null],
    ['\\\\fileserver\\share\\valida-private', null],
    ['C:\\Users\\QA\\AppData\\Local\\valida-private', null],
    ['\\valida-data', 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE'],
    ['C:valida-data', 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE'],
    ['valida-data', 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE'],
    ['C:\\data:stream', 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE'],
    ['C:\\', 'RESUME_STORAGE_LOCAL_ROOT_FILESYSTEM_ROOT'],
    ['D:', 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE'],
    ['\\\\fileserver\\share\\', 'RESUME_STORAGE_LOCAL_ROOT_FILESYSTEM_ROOT'],
    ['C:\\Users\\Public\\resumes', 'RESUME_STORAGE_LOCAL_ROOT_PUBLIC_DIRECTORY'],
    ['C:\\inetpub\\wwwroot\\resumes', 'RESUME_STORAGE_LOCAL_ROOT_PUBLIC_DIRECTORY'],
    ['C:\\ME\\valida\\backend\\storage', 'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION'],
    ['c:\\me\\VALIDA\\frontend', 'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION'],
    ['C:\\ME', 'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION'],
  ])('%j -> %s', (value, expected) => {
    expect(check(value)).toBe(expected);
  });
});

describe('failure messages never echo the path', () => {
  it.each([
    'relative/secret-path-marker',
    '/srv/public/secret-path-marker',
    path.join(APPLICATION_ROOT, 'secret-path-marker'),
  ])('%j', (value) => {
    const error = failureOf({ ...base, RESUME_STORAGE_DRIVER: 'local', RESUME_STORAGE_LOCAL_ROOT: value });
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).not.toContain('secret-path-marker');
    expect(JSON.stringify(error.issues)).not.toContain('secret-path-marker');
  });
});
