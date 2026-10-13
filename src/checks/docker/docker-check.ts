import { sanitizeOutput, tailLines } from '../../core/output.js';
import { runProcess } from '../../core/process.js';
import type { DockerCheckConfig, DockerExpectation } from '../../types/index.js';
import type { CheckDefinition, CheckOutcome } from '../definition.js';

export const DEFAULT_DOCKER_TIMEOUT_MS = 15_000;
const EXPECTATIONS: readonly DockerExpectation[] = ['exists', 'running', 'healthy'];

interface ContainerState {
  Status?: string;
  Running?: boolean;
  ExitCode?: number;
  Health?: { Status?: string };
}

export const dockerCheck: CheckDefinition<DockerCheckConfig> = {
  type: 'docker',
  description: 'Inspects a Docker container: exists, running, or healthy (via its HEALTHCHECK).',

  parse(reader, base) {
    return {
      ...base,
      type: 'docker',
      container: reader.requiredString('container'),
      expect: reader.oneOf('expect', EXPECTATIONS, 'running'),
    };
  },

  describe(config) {
    return `docker container \`${config.container}\` is ${config.expect === 'exists' ? 'present' : config.expect}`;
  },

  async run(config, context): Promise<CheckOutcome> {
    const { command, args } = context.tools.docker;
    const evidence: Record<string, unknown> = { container: config.container, expect: config.expect };
    const result = await runProcess(
      command,
      [...args, 'inspect', '--type', 'container', '--format', '{{json .State}}', config.container],
      { cwd: context.projectRoot, timeoutMs: config.timeoutMs ?? DEFAULT_DOCKER_TIMEOUT_MS },
    );

    if (result.spawnError) {
      const message =
        result.spawnError.code === 'ENOENT'
          ? 'Docker CLI not found on PATH'
          : `could not run docker: ${result.spawnError.message}`;
      return { status: 'NOT_CHECKED', summary: message, evidence };
    }
    if (result.timedOut) {
      return { status: 'NOT_CHECKED', summary: 'docker inspect did not respond before the timeout', evidence };
    }

    const stderr = sanitizeOutput(result.stderr);
    if (result.exitCode !== 0) {
      evidence.stderrTail = tailLines(stderr, 5);
      if (/no such (object|container)/i.test(stderr)) {
        return { status: 'FAIL', summary: `container ${config.container} not found`, evidence };
      }
      if (/cannot connect to the docker daemon|error during connect|docker daemon is not running|permission denied/i.test(stderr)) {
        return { status: 'NOT_CHECKED', summary: 'Docker daemon is not reachable', details: tailLines(stderr, 3), evidence };
      }
      return {
        status: 'ERROR',
        summary: `docker inspect exited with code ${result.exitCode}`,
        details: tailLines(stderr, 5),
        evidence,
      };
    }

    let state: ContainerState;
    try {
      state = JSON.parse(result.stdout.trim()) as ContainerState;
    } catch {
      return { status: 'ERROR', summary: 'could not parse docker inspect output', evidence };
    }
    const health = state.Health?.Status ?? null;
    Object.assign(evidence, { state: state.Status ?? null, running: state.Running === true, health });

    const stateText = `state ${state.Status ?? 'unknown'}${health ? `, health ${health}` : ''}`;
    if (config.expect === 'exists') {
      return { status: 'PASS', summary: `container exists (${stateText})`, evidence };
    }
    if (state.Running !== true) {
      return { status: 'FAIL', summary: `container is not running (${stateText})`, evidence };
    }
    if (config.expect === 'running') {
      return { status: 'PASS', summary: `container is running${health ? ` (health ${health})` : ''}`, evidence };
    }
    if (health === null) {
      return {
        status: 'NOT_CHECKED',
        summary: 'container is running but defines no HEALTHCHECK, so health cannot be verified',
        evidence,
      };
    }
    if (health === 'healthy') return { status: 'PASS', summary: 'container is running and healthy', evidence };
    return { status: 'FAIL', summary: `container health is ${health}`, evidence };
  },
};
