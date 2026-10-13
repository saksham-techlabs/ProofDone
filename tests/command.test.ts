import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { commandCheck } from '../src/checks/command/command-check.js';
import type { CommandCheckConfig } from '../src/types/index.js';
import { base, context, makeTempDir, nodeCommand, removeDir, writeFiles } from './helpers.js';

function check(command: string, extra: Partial<CommandCheckConfig> = {}): CommandCheckConfig {
  return { ...base('cmd'), type: 'command', command, env: {}, expectExitCode: 0, ...extra };
}

describe('command check', () => {
  let dir: string;
  before(async () => {
    dir = await makeTempDir();
    await writeFiles(dir, { 'sub/marker.txt': 'x' });
  });
  after(async () => {
    await removeDir(dir);
  });

  it('passes when the real command exits 0 and records evidence', async () => {
    const outcome = await commandCheck.run(check(nodeCommand("console.log('build ok')")), context(dir));
    assert.equal(outcome.status, 'PASS');
    assert.match(outcome.summary, /^exit 0 in /);
    assert.equal(outcome.evidence?.exitCode, 0);
    assert.deepEqual(outcome.evidence?.stdoutTail, ['build ok']);
    assert.equal(typeof outcome.evidence?.durationMs, 'number');
  });

  it('fails on a non-zero exit and shows the output tail', async () => {
    const outcome = await commandCheck.run(
      check(nodeCommand("console.log('compiling'); console.error('error TS2322: bad type'); process.exit(3)")),
      context(dir),
    );
    assert.equal(outcome.status, 'FAIL');
    assert.match(outcome.summary, /exit 3 \(expected 0\)/);
    assert.ok(outcome.details?.some((line) => line.includes('error TS2322')));
  });

  it('supports a custom expected exit code', async () => {
    const outcome = await commandCheck.run(check(nodeCommand('process.exit(3)'), { expectExitCode: 3 }), context(dir));
    assert.equal(outcome.status, 'PASS');
  });

  it('fails (never passes) when the command does not exist', async () => {
    const outcome = await commandCheck.run(check('proofdone-command-that-does-not-exist-xyz'), context(dir));
    assert.equal(outcome.status, 'FAIL');
    assert.notEqual(outcome.evidence?.exitCode, 0);
  });

  it('times out long-running commands', async () => {
    const started = Date.now();
    const outcome = await commandCheck.run(
      check(nodeCommand("console.log('starting'); setTimeout(() => {}, 60000)"), { timeoutMs: 1500 }),
      context(dir),
    );
    assert.equal(outcome.status, 'FAIL');
    assert.match(outcome.summary, /Timed out after 1\.5s/);
    assert.equal(outcome.evidence?.timedOut, true);
    assert.ok(Date.now() - started < 20_000);
  });

  it('closes stdin so interactive prompts cannot hang verification', async () => {
    const outcome = await commandCheck.run(
      check(nodeCommand("process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"), { timeoutMs: 10_000 }),
      context(dir),
    );
    assert.equal(outcome.status, 'PASS');
  });

  it('runs in the configured working directory', async () => {
    const outcome = await commandCheck.run(
      check(nodeCommand("console.log(require('fs').existsSync('marker.txt'))"), { cwd: 'sub' }),
      context(dir),
    );
    assert.equal(outcome.status, 'PASS');
    assert.deepEqual(outcome.evidence?.stdoutTail, ['true']);
  });

  it('reports a missing working directory as ERROR', async () => {
    const outcome = await commandCheck.run(check('echo hi', { cwd: 'does-not-exist' }), context(dir));
    assert.equal(outcome.status, 'ERROR');
    assert.match(outcome.summary, /does not exist/);
  });

  it('passes env values and redacts them from captured output', async () => {
    const outcome = await commandCheck.run(
      check(nodeCommand("console.log('token=' + process.env.PD_TEST_TOKEN)"), {
        env: { PD_TEST_TOKEN: 'super-secret-value-123' },
      }),
      context(dir),
    );
    assert.equal(outcome.status, 'PASS');
    assert.deepEqual(outcome.evidence?.stdoutTail, ['token=[REDACTED]']);
  });

  it('does not create files on its own (verification only)', async () => {
    await commandCheck.run(check(nodeCommand('process.exit(0)')), context(dir));
    assert.equal(existsSync(path.join(dir, 'proofdone.config.json')), false);
  });
});
