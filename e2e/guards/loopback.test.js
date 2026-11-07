import assert from 'node:assert/strict';
import http from 'node:http';
import { after, describe, it } from 'node:test';
import { loopbackProblem, reachFromOtherInterfaces } from '../support/loopback.js';

/**
 * C3 r2, GPT finding 2 — the setup proceeds only when the backend reports that
 * its socket listens on 127.0.0.1 (IPv4) at the expected port. The launcher
 * reads that from server.address(); the real launcher is exercised by every
 * E2E run (run.json: backendListening). Here: the check itself, and the probe
 * of the machine's other interfaces against real sockets.
 */

describe('loopbackProblem: only 127.0.0.1, IPv4, the expected port', () => {
  it('accepts 127.0.0.1:4100 IPv4', () => assert.equal(loopbackProblem({ address: '127.0.0.1', family: 'IPv4', port: 4100 }, 4100), null));
  for (const [label, listening] of [
    ['every IPv4 interface', { address: '0.0.0.0', family: 'IPv4', port: 4100 }],
    ['every interface (dual stack)', { address: '::', family: 'IPv6', port: 4100 }],
    ['IPv6 loopback', { address: '::1', family: 'IPv6', port: 4100 }],
    ['a LAN address', { address: '192.0.2.10', family: 'IPv4', port: 4100 }],
    ['another port', { address: '127.0.0.1', family: 'IPv4', port: 4101 }],
    ['no address', null],
  ]) {
    it(`refuses ${label}`, () => assert.notEqual(loopbackProblem(listening, 4100), null));
  }
});

describe('reachFromOtherInterfaces against real sockets', () => {
  const servers = [];
  after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));
  const listen = (host) =>
    new Promise((resolve) => {
      const server = http.createServer((_req, res) => res.end('ok'));
      servers.push(server);
      server.listen(0, host, () => resolve(server.address().port));
    });

  it('a server bound to 127.0.0.1 is not reachable on any other IPv4 address of this machine', async () => {
    const port = await listen('127.0.0.1');
    const attempts = await reachFromOtherInterfaces(port);
    assert.equal(attempts.some((attempt) => attempt.result === 'connected'), false, JSON.stringify(attempts));
  });

  it('a server bound to every interface IS reachable there (so the probe can see a wrong binding)', async (t) => {
    const port = await listen('0.0.0.0');
    const attempts = await reachFromOtherInterfaces(port);
    if (attempts.length === 0) return t.skip('this machine has no non-loopback IPv4 address');
    assert.equal(attempts.every((attempt) => attempt.result === 'connected'), true, JSON.stringify(attempts));
  });
});
