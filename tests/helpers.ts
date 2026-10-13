import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TOOLS, type CheckContext, type ToolPaths } from '../src/checks/definition.js';
import type { BaseCheckConfig } from '../src/types/index.js';

/** Repository root (tests are compiled to .test-build/tests/). */
export const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const CLI_PATH = path.join(REPO_ROOT, '.test-build', 'src', 'cli', 'main.js');

export async function makeTempDir(prefix = 'proofdone-test-'): Promise<string> {
  // realpath: macOS tmpdir is a symlink (/var -> /private/var), which git reports resolved.
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Creates a git repository with a local identity and an initial commit of `files`. */
export async function initRepo(dir: string, files: Record<string, string> = { 'README.md': '# Test\n' }): Promise<void> {
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'ProofDone Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  await writeFiles(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'initial');
}

export function context(projectRoot: string, tools: Partial<ToolPaths> = {}): CheckContext {
  return { projectRoot, tools: { ...DEFAULT_TOOLS, ...tools } };
}

export function base(id: string, extra: Partial<BaseCheckConfig> = {}): BaseCheckConfig {
  return { id, name: id, required: true, ...extra };
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the compiled CLI as a real child process (async, so in-process servers keep serving). */
export function runCliProcess(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** A shell command that runs a short Node.js snippet; works in cmd.exe and /bin/sh. */
export function nodeCommand(code: string): string {
  if (code.includes('"')) throw new Error('nodeCommand snippets must not contain double quotes');
  return `node -e "${code}"`;
}
