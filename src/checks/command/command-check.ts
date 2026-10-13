import { stat } from 'node:fs/promises';
import { formatDuration, sanitizeOutput, tailLines } from '../../core/output.js';
import { resolveInProject } from '../../core/paths.js';
import { runProcess } from '../../core/process.js';
import type { CommandCheckConfig } from '../../types/index.js';
import type { CheckDefinition, CheckOutcome } from '../definition.js';

export const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const STORED_TAIL_LINES = 40;
const STORED_TAIL_CHARS = 4000;
const DISPLAY_TAIL_LINES = 15;

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export const commandCheck: CheckDefinition<CommandCheckConfig> = {
  type: 'command',
  description: 'Runs a configured shell command and requires the expected exit code.',

  parse(reader, base) {
    const cwd = reader.optionalPath('cwd');
    const config: CommandCheckConfig = {
      ...base,
      type: 'command',
      command: reader.requiredString('command'),
      env: reader.stringRecord('env'),
      expectExitCode: reader.optionalInteger('expectExitCode', 0, 255) ?? 0,
    };
    if (cwd !== undefined) config.cwd = cwd;
    return config;
  },

  describe(config) {
    const where = config.cwd ? ` (in ${config.cwd})` : '';
    const expect = config.expectExitCode === 0 ? '' : `, expect exit ${config.expectExitCode}`;
    return `run \`${config.command}\`${where}${expect}`;
  },

  async run(config, context): Promise<CheckOutcome> {
    const cwd = config.cwd ? resolveInProject(context.projectRoot, config.cwd) : context.projectRoot;
    const evidence: Record<string, unknown> = { command: config.command, cwd: config.cwd ?? '.' };

    if (!(await isDirectory(cwd))) {
      return {
        status: 'ERROR',
        summary: `Working directory does not exist: ${config.cwd ?? '.'}`,
        evidence,
      };
    }

    const timeoutMs = config.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const result = await runProcess(config.command, [], {
      cwd,
      shell: true,
      timeoutMs,
      env: { ...process.env, ...config.env },
    });

    const secrets = Object.values(config.env);
    const stdout = sanitizeOutput(result.stdout, secrets);
    const stderr = sanitizeOutput(result.stderr, secrets);
    Object.assign(evidence, {
      exitCode: result.exitCode,
      expectedExitCode: config.expectExitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      durationMs: Math.round(result.durationMs),
      stdoutTail: tailLines(stdout, STORED_TAIL_LINES, STORED_TAIL_CHARS),
      stderrTail: tailLines(stderr, STORED_TAIL_LINES, STORED_TAIL_CHARS),
      outputTruncated: result.outputTruncated,
    });

    if (result.spawnError) {
      return {
        status: 'ERROR',
        summary: `Could not start command: ${result.spawnError.message}`,
        evidence,
      };
    }

    const duration = formatDuration(result.durationMs);
    const outputTail = tailLines(stderr.trim() ? `${stdout}\n${stderr}` : stdout, DISPLAY_TAIL_LINES);

    if (result.timedOut) {
      return {
        status: 'FAIL',
        summary: `Timed out after ${formatDuration(timeoutMs)}; the process was terminated`,
        details: outputTail.length ? ['Last output:', ...outputTail] : [],
        evidence,
      };
    }

    if (result.exitCode === config.expectExitCode) {
      return { status: 'PASS', summary: `exit ${result.exitCode} in ${duration}`, evidence };
    }

    const exitText = result.exitCode === null ? `killed by ${result.signal ?? 'signal'}` : `exit ${result.exitCode}`;
    return {
      status: 'FAIL',
      summary: `${exitText} (expected ${config.expectExitCode}) in ${duration}`,
      details: outputTail.length ? ['Last output:', ...outputTail] : ['The command produced no output.'],
      evidence,
    };
  },
};
