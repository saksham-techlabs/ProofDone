import { spawn, type ChildProcess } from 'node:child_process';

export interface RunProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Run `command` through the platform shell (cmd.exe on Windows, /bin/sh elsewhere). */
  shell?: boolean;
  /** Maximum bytes retained per stream; older output is discarded. */
  maxOutputBytes?: number;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  outputTruncated: boolean;
  /** Set when the process could not be started at all (e.g. ENOENT). */
  spawnError?: { code?: string; message: string };
}

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
/** How long to wait for stdio to close after the process exits (background grandchildren may hold pipes). */
const CLOSE_GRACE_MS = 2000;

const activeChildren = new Set<ChildProcess>();

/** Keeps the most recent `max` bytes of a stream. */
class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  truncated = false;

  constructor(private readonly max: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size > this.max * 2) this.compact();
  }

  private compact(): void {
    const all = Buffer.concat(this.chunks);
    if (all.length > this.max) {
      this.truncated = true;
      this.chunks = [all.subarray(all.length - this.max)];
    } else {
      this.chunks = [all];
    }
    this.size = this.chunks[0]?.length ?? 0;
  }

  toString(): string {
    this.compact();
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/** Kills a child and its descendants. Best effort; never throws. */
export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => child.kill());
    } else {
      // The child was spawned detached, so it leads its own process group.
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Process already gone.
    }
  }
}

/** Kills every process currently started by ProofDone (used on Ctrl+C). */
export function killActiveProcesses(): void {
  for (const child of activeChildren) killProcessTree(child);
}

/**
 * Runs a process to completion, capturing output. Never rejects: spawn failures,
 * timeouts and non-zero exits are all reported in the result.
 * stdin is closed so interactive prompts cannot hang verification.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const started = performance.now();
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const stdout = new TailBuffer(maxBytes);
  const stderr = new TailBuffer(maxBytes);

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let child: ChildProcess;
    let timeoutTimer: NodeJS.Timeout | undefined = undefined;
    let graceTimer: NodeJS.Timeout | undefined = undefined;

    const finish = (
      exitCode: number | null,
      signal: string | null,
      spawnError?: ProcessResult['spawnError'],
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
      activeChildren.delete(child);
      const result: ProcessResult = {
        exitCode,
        signal,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: performance.now() - started,
        timedOut,
        outputTruncated: stdout.truncated || stderr.truncated,
      };
      if (spawnError) result.spawnError = spawnError;
      resolve(result);
    };

    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: options.shell ?? false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      const spawnError: ProcessResult['spawnError'] = { message: err.message };
      if (err.code) spawnError.code = err.code;
      settled = true;
      resolve({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: performance.now() - started,
        timedOut: false,
        outputTruncated: false,
        spawnError,
      });
      return;
    }

    activeChildren.add(child);
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, options.timeoutMs);

    child.on('error', (error: NodeJS.ErrnoException) => {
      const spawnError: ProcessResult['spawnError'] = { message: error.message };
      if (error.code) spawnError.code = error.code;
      finish(null, null, spawnError);
    });
    child.on('exit', (code, signal) => {
      graceTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(code, signal);
      }, CLOSE_GRACE_MS);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
}
