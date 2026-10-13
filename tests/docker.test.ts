import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { dockerCheck } from '../src/checks/docker/docker-check.js';
import type { DockerCheckConfig, DockerExpectation } from '../src/types/index.js';
import { base, context, makeTempDir, removeDir } from './helpers.js';

/**
 * A stand-in `docker` executable (a real process) that emulates `docker inspect`
 * responses, so the parsing and failure handling run end-to-end without Docker.
 */
const FAKE_DOCKER = `
const [mode, ...args] = process.argv.slice(2);
if (args[0] !== 'inspect' || !args.includes('--format') || args.at(-1) !== 'web') {
  console.error('unexpected arguments: ' + args.join(' '));
  process.exit(99);
}
const states = {
  running: { Status: 'running', Running: true },
  healthy: { Status: 'running', Running: true, Health: { Status: 'healthy' } },
  unhealthy: { Status: 'running', Running: true, Health: { Status: 'unhealthy' } },
  exited: { Status: 'exited', Running: false, ExitCode: 1 },
};
if (mode === 'missing') { console.error('Error: No such container: web'); process.exit(1); }
if (mode === 'daemon-down') {
  console.error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
  process.exit(1);
}
if (mode === 'weird') { console.error('something unexpected'); process.exit(5); }
if (mode === 'garbage') { console.log('not json'); process.exit(0); }
console.log(JSON.stringify(states[mode]));
`;

describe('docker check', () => {
  let dir: string;
  let script: string;

  before(async () => {
    dir = await makeTempDir();
    script = path.join(dir, 'fake-docker.cjs');
    await writeFile(script, FAKE_DOCKER);
  });
  after(async () => {
    await removeDir(dir);
  });

  const run = (mode: string, expect: DockerExpectation = 'running') => {
    const config: DockerCheckConfig = { ...base('docker'), type: 'docker', container: 'web', expect };
    return dockerCheck.run(config, context(dir, { docker: { command: process.execPath, args: [script, mode] } }));
  };

  it('reports NOT_CHECKED when the Docker CLI is not installed', async () => {
    const config: DockerCheckConfig = { ...base('docker'), type: 'docker', container: 'web', expect: 'running' };
    const outcome = await dockerCheck.run(
      config,
      context(dir, { docker: { command: 'proofdone-missing-docker-binary', args: [] } }),
    );
    assert.equal(outcome.status, 'NOT_CHECKED');
    assert.equal(outcome.summary, 'Docker CLI not found on PATH');
  });

  it('reports NOT_CHECKED when the daemon is unreachable', async () => {
    const outcome = await run('daemon-down');
    assert.equal(outcome.status, 'NOT_CHECKED');
    assert.equal(outcome.summary, 'Docker daemon is not reachable');
  });

  it('passes for a running container', async () => {
    const outcome = await run('running');
    assert.equal(outcome.status, 'PASS');
    assert.equal(outcome.evidence?.running, true);
  });

  it('fails for a missing or stopped container', async () => {
    const missing = await run('missing', 'exists');
    assert.equal(missing.status, 'FAIL');
    assert.equal(missing.summary, 'container web not found');
    const exited = await run('exited');
    assert.equal(exited.status, 'FAIL');
    assert.match(exited.summary, /not running \(state exited\)/);
    const exists = await run('exited', 'exists');
    assert.equal(exists.status, 'PASS');
  });

  it('checks health status when expect is healthy', async () => {
    assert.equal((await run('healthy', 'healthy')).status, 'PASS');
    const unhealthy = await run('unhealthy', 'healthy');
    assert.equal(unhealthy.status, 'FAIL');
    assert.equal(unhealthy.summary, 'container health is unhealthy');
  });

  it('never passes health for a container without a HEALTHCHECK', async () => {
    const outcome = await run('running', 'healthy');
    assert.equal(outcome.status, 'NOT_CHECKED');
    assert.match(outcome.summary, /no HEALTHCHECK/);
  });

  it('reports ERROR for unexpected docker failures and output', async () => {
    assert.equal((await run('weird')).status, 'ERROR');
    assert.equal((await run('garbage')).status, 'ERROR');
  });
});
