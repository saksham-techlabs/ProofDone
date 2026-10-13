import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { httpCheck } from '../src/checks/http/http-check.js';
import type { HttpCheckConfig } from '../src/types/index.js';
import { base, context } from './helpers.js';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('http check (real local server)', () => {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', db: 'connected' }));
    } else if (req.url === '/broken') {
      res.writeHead(500);
      res.end('Internal error: token ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: '/health' });
      res.end();
    } else if (req.url === '/slow') {
      // Never responds.
    } else if (req.url === '/slow-body') {
      res.writeHead(200);
      res.write('started');
    } else if (req.url === '/large') {
      res.end('x'.repeat(1024 * 1024) + 'needle');
    } else if (req.url === '/exact-limit') {
      res.end('x'.repeat(1024 * 1024));
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  let origin = '';
  const ctx = context(process.cwd());
  const check = (pathname: string, extra: Partial<HttpCheckConfig> = {}): HttpCheckConfig => ({
    ...base('http'),
    type: 'http',
    url: `${origin}${pathname}`,
    method: 'GET',
    ...extra,
  });

  before(async () => {
    origin = `http://127.0.0.1:${await listen(server)}`;
  });
  after(async () => {
    await close(server);
  });

  it('passes on a 2xx response and records evidence', async () => {
    const outcome = await httpCheck.run(check('/health'), ctx);
    assert.equal(outcome.status, 'PASS');
    assert.match(outcome.summary, /^200 in /);
    assert.equal(outcome.evidence?.status, 200);
    assert.match(String(outcome.evidence?.bodySnippet), /"status":"ok"/);
  });

  it('checks the response body', async () => {
    const ok = await httpCheck.run(check('/health', { bodyContains: '"db":"connected"' }), ctx);
    assert.equal(ok.status, 'PASS');
    const bad = await httpCheck.run(check('/health', { bodyContains: 'ready' }), ctx);
    assert.equal(bad.status, 'FAIL');
    assert.match(bad.summary, /does not contain "ready"/);
  });

  it('fails on an unexpected status and redacts the body snippet', async () => {
    const outcome = await httpCheck.run(check('/broken'), ctx);
    assert.equal(outcome.status, 'FAIL');
    assert.equal(outcome.summary, 'status 500 (expected 2xx)');
    assert.ok(!JSON.stringify(outcome).includes('ghp_'));
  });

  it('honors explicit expected statuses', async () => {
    const outcome = await httpCheck.run(check('/missing', { expectStatus: [404] }), ctx);
    assert.equal(outcome.status, 'PASS');
  });

  it('follows redirects', async () => {
    const outcome = await httpCheck.run(check('/redirect'), ctx);
    assert.equal(outcome.status, 'PASS');
    assert.equal(outcome.evidence?.finalUrl, `${origin}/health`);
  });

  it('supports HEAD requests', async () => {
    const outcome = await httpCheck.run(check('/health', { method: 'HEAD' }), ctx);
    assert.equal(outcome.status, 'PASS');
  });

  it('fails gracefully on timeout', async () => {
    const started = Date.now();
    const outcome = await httpCheck.run(check('/slow', { timeoutMs: 300 }), ctx);
    assert.equal(outcome.status, 'FAIL');
    assert.equal(outcome.summary, 'no response within 300ms');
    assert.equal(outcome.evidence?.timedOut, true);
    assert.ok(Date.now() - started < 5000);
  });

  it('fails when nothing is listening', async () => {
    const temp = createServer();
    const port = await listen(temp);
    await close(temp);
    const outcome = await httpCheck.run({ ...check('/'), url: `http://127.0.0.1:${port}/health` }, ctx);
    assert.equal(outcome.status, 'FAIL');
    assert.match(outcome.summary, /connection refused/);
  });

  it('times out while reading a body after receiving headers', async () => {
    const outcome = await httpCheck.run(check('/slow-body', { timeoutMs: 300 }), ctx);
    assert.equal(outcome.status, 'FAIL');
    assert.equal(outcome.evidence?.timedOut, true);
  });

  it('reports incomplete body evidence without claiming the required text is absent', async () => {
    const missing = await httpCheck.run(check('/large', { bodyContains: 'needle' }), ctx);
    assert.equal(missing.status, 'NOT_CHECKED');
    assert.equal(missing.evidence?.bodyTruncated, true);
    const found = await httpCheck.run(check('/large', { bodyContains: 'xxx' }), ctx);
    assert.equal(found.status, 'PASS');
    const exact = await httpCheck.run(check('/exact-limit', { bodyContains: 'needle' }), ctx);
    assert.equal(exact.status, 'FAIL');
    assert.equal(exact.evidence?.bodyTruncated, false);
  });
});
