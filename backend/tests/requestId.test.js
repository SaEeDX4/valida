import { describe, it, expect, vi } from 'vitest';
import { requestId } from '../src/middleware/requestId.js';

/**
 * Request-id validation at the unit level.
 *
 * Some hostile values cannot be tested over HTTP at all: a compliant client
 * (and Node's own HTTP parser) refuses to send a header containing a newline,
 * so supertest cannot deliver one. The middleware is therefore exercised
 * directly, which is the only way to prove it would reject such a value if one
 * ever arrived — for example through a non-compliant proxy.
 */
function runMiddleware(inboundHeader) {
  const req = { get: (name) => (name.toLowerCase() === 'x-request-id' ? inboundHeader : undefined) };
  const res = { setHeader: vi.fn() };
  const next = vi.fn();
  requestId()(req, res, next);
  return { req, res, next };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('request id middleware', () => {
  it('generates a UUID v4 when no id is supplied', () => {
    const { req, res, next } = runMiddleware(undefined);
    expect(req.id).toMatch(UUID);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts a well-formed inbound id', () => {
    const { req } = runMiddleware('trace-abc-123456');
    expect(req.id).toBe('trace-abc-123456');
  });

  it.each([
    ['newline injection', 'abcdefgh\ninjected'],
    ['carriage return', 'abcdefgh\rSet-Cookie: x=1'],
    ['null byte', 'abcdefgh\u0000'],
    ['log-forging braces', 'abcdefgh{"level":"fatal"}'],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['spaces', 'abcd efgh'],
    ['non-string', 12345678],
  ])('rejects %s and generates a fresh id', (_label, inbound) => {
    const { req } = runMiddleware(inbound);
    expect(req.id).not.toBe(inbound);
    expect(req.id).toMatch(UUID);
  });

  it('accepts the exact boundary lengths', () => {
    expect(runMiddleware('a'.repeat(8)).req.id).toBe('a'.repeat(8));
    expect(runMiddleware('a'.repeat(128)).req.id).toBe('a'.repeat(128));
  });
});
