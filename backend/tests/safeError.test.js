import { describe, it, expect } from 'vitest';
import { safeErrorSummary } from '../src/lib/safeError.js';
import { capturingLogger } from './helpers.js';

/**
 * Safe error summarisation — Doc 13.
 *
 * `name` and `code` are ordinary writable properties. Any library, or anything
 * able to influence what a library throws, can set them to arbitrary text — so
 * they are treated as untrusted and never copied into the output.
 */
const SECRET_NAME = 'mongodb+srv://admin:s3cr3t@cluster0.example.net/valida';

describe('error type comes from a fixed table, not error.name', () => {
  it('ignores a hostile name entirely', () => {
    const error = new Error('boom');
    error.name = SECRET_NAME;
    expect(safeErrorSummary(error)).toEqual({ type: 'Error' });
  });

  it('classifies built-in errors by instanceof', () => {
    expect(safeErrorSummary(new TypeError('x')).type).toBe('TypeError');
    expect(safeErrorSummary(new RangeError('x')).type).toBe('RangeError');
    expect(safeErrorSummary(new SyntaxError('x')).type).toBe('SyntaxError');
    expect(safeErrorSummary(new ReferenceError('x')).type).toBe('ReferenceError');
  });

  it('cannot be fooled by a forged name on a real built-in', () => {
    const error = new TypeError('x');
    error.name = 'AKIAEXAMPLE';
    // instanceof decides, so the forged name is irrelevant.
    expect(safeErrorSummary(error).type).toBe('TypeError');
  });

  it('falls back to the generic type for a custom subclass', () => {
    class TenantError extends Error {}
    const error = new TenantError('x');
    error.name = SECRET_NAME;
    expect(safeErrorSummary(error)).toEqual({ type: 'Error' });
  });

  it('records only the typeof for a non-Error throw', () => {
    // The thrown value itself could be a request body or a token.
    expect(safeErrorSummary('s3cr3t')).toEqual({ type: 'non-error:string' });
    expect(safeErrorSummary({ token: 'AKIAEXAMPLE' })).toEqual({ type: 'non-error:object' });
    expect(safeErrorSummary(null)).toEqual({ type: 'unknown' });
    expect(safeErrorSummary(undefined)).toEqual({ type: 'unknown' });
  });
});

describe('error code comes from a fixed allowlist, not a pattern', () => {
  it('keeps the Node conditions B1 actually needs', () => {
    const bind = new Error('x');
    bind.code = 'EADDRINUSE';
    expect(safeErrorSummary(bind)).toEqual({ type: 'Error', code: 'EADDRINUSE' });
  });

  it.each([
    'AKIAEXAMPLE',
    'AWS_SECRET_ACCESS_KEY',
    'MONGODB_URI',
    'ECONNREFUSED',
    'SOME_UNLISTED_CODE',
  ])('drops an unlisted code: %s', (code) => {
    const error = new Error('x');
    error.code = code;
    expect(safeErrorSummary(error)).toEqual({ type: 'Error' });
  });

  it('ignores a non-string code', () => {
    const error = new Error('x');
    error.code = { toString: () => 'EADDRINUSE' };
    expect(safeErrorSummary(error)).toEqual({ type: 'Error' });
  });

  it('never carries message, stack or cause', () => {
    const error = new Error(SECRET_NAME, { cause: new Error('AKIAEXAMPLE') });
    const summary = safeErrorSummary(error);
    expect(Object.keys(summary)).toEqual(['type']);
  });
});

describe('written log output contains no untrusted error text', () => {
  it('suppresses a hostile name and code in real pino output', () => {
    const { logger, output } = capturingLogger();

    const hostile = new Error('inner detail');
    hostile.name = SECRET_NAME;
    hostile.code = 'AKIAEXAMPLE';

    logger.error({ reqId: 'req-1234abcd', err: safeErrorSummary(hostile) }, 'unhandled error');

    const logged = output();
    // Correlation and a fixed classification remain available.
    expect(logged).toMatch(/req-1234abcd/);
    expect(logged).toMatch(/"type":"Error"/);
    // Nothing from the error object itself.
    [/mongodb\+srv/i, /s3cr3t/, /admin:/, /AKIAEXAMPLE/, /inner detail/, /"stack"/].forEach(
      (pattern) => expect(logged, `leaked ${pattern}`).not.toMatch(pattern),
    );
  });
});
