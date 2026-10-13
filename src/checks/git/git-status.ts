import { sanitizeOutput, tailLines } from '../../core/output.js';
import { runProcess, type ProcessResult } from '../../core/process.js';
import type { CheckContext, CheckOutcome } from '../definition.js';

export const DEFAULT_GIT_TIMEOUT_MS = 30_000;

export interface GitStatus {
  /** Current branch name, or null when HEAD is detached. */
  branch: string | null;
  /** Commit id of HEAD, or null before the first commit. */
  head: string | null;
  upstream: string | null;
  /** Commits ahead/behind upstream; null when there is no (reachable) upstream. */
  ahead: number | null;
  behind: number | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  conflicted: string[];
}

export type GitFailure =
  | { kind: 'unavailable'; message: string }
  | { kind: 'not-repo'; message: string }
  | { kind: 'error'; message: string };

export type GitProbe = { kind: 'ok'; status: GitStatus } | GitFailure;

/**
 * Runs git read-only. GIT_OPTIONAL_LOCKS=0 stops `git status` from refreshing
 * (writing) the index, so verification never modifies the repository.
 */
export function runGit(context: CheckContext, args: readonly string[], timeoutMs: number): Promise<ProcessResult> {
  const { command, args: prefix } = context.tools.git;
  return runProcess(command, [...prefix, ...args], {
    cwd: context.projectRoot,
    timeoutMs,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
}

export function classifyGitFailure(result: ProcessResult): GitFailure | undefined {
  if (result.spawnError) {
    const message =
      result.spawnError.code === 'ENOENT'
        ? 'git is not installed or not on PATH'
        : `could not run git: ${result.spawnError.message}`;
    return { kind: 'unavailable', message };
  }
  if (result.timedOut) return { kind: 'unavailable', message: 'git did not respond before the timeout' };
  if (result.exitCode !== 0) {
    const stderr = sanitizeOutput(result.stderr);
    if (/not a git repository/i.test(stderr)) {
      return { kind: 'not-repo', message: 'Not inside a git repository' };
    }
    const tail = tailLines(stderr, 3).join(' ');
    return { kind: 'error', message: `git exited with code ${result.exitCode}${tail ? `: ${tail}` : ''}` };
  }
  return undefined;
}

export async function probeGit(context: CheckContext, timeoutMs = DEFAULT_GIT_TIMEOUT_MS): Promise<GitProbe> {
  const result = await runGit(
    context,
    ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'],
    timeoutMs,
  );
  return classifyGitFailure(result) ?? { kind: 'ok', status: parsePorcelainV2(result.stdout) };
}

/** Takes the remainder of a line after `count` space-separated fields. */
function fieldsAfter(line: string, count: number): string {
  let index = 0;
  for (let i = 0; i < count; i++) {
    index = line.indexOf(' ', index);
    if (index === -1) return '';
    index += 1;
  }
  return line.slice(index);
}

/** Parses `git status --porcelain=v2 --branch -z` output. */
export function parsePorcelainV2(output: string): GitStatus {
  const status: GitStatus = {
    branch: null,
    head: null,
    upstream: null,
    ahead: null,
    behind: null,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  };
  const entries = output.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    if (entry.length === 0) continue;
    const kind = entry[0];

    if (kind === '#') {
      const [, key, ...rest] = entry.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') status.head = value === '(initial)' ? null : value;
      else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') status.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          status.ahead = Number(match[1]);
          status.behind = Number(match[2]);
        }
      }
    } else if (kind === '1' || kind === '2') {
      const xy = entry.slice(2, 4);
      const filePath = fieldsAfter(entry, kind === '1' ? 8 : 9);
      if (xy[0] !== '.') status.staged.push(filePath);
      if (xy[1] !== '.') status.unstaged.push(filePath);
      if (kind === '2') i += 1; // The original path of a rename/copy follows as its own entry.
    } else if (kind === 'u') {
      status.conflicted.push(fieldsAfter(entry, 10));
    } else if (kind === '?') {
      status.untracked.push(entry.slice(2));
    }
  }
  return status;
}

/** Converts a non-ok probe into a check outcome. Missing git is NOT_CHECKED, never PASS. */
export function probeFailureOutcome(probe: GitFailure): CheckOutcome {
  switch (probe.kind) {
    case 'unavailable':
      return { status: 'NOT_CHECKED', summary: `Could not inspect git: ${probe.message}` };
    case 'not-repo':
      return { status: 'FAIL', summary: 'Project is not inside a git repository' };
    case 'error':
      return { status: 'ERROR', summary: probe.message };
  }
}

export function describeBranch(status: GitStatus): string {
  return status.branch ?? `detached HEAD${status.head ? ` at ${status.head.slice(0, 7)}` : ''}`;
}
