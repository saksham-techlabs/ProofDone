import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type JsonCheck = Record<string, unknown>;

export interface StarterConfig {
  config: { version: 1; checks: JsonCheck[] };
  notes: string[];
}

/** Script name -> display name, in the order checks should run. */
const SCRIPT_CHECKS: readonly [string, string][] = [
  ['typecheck', 'Typecheck'],
  ['lint', 'Lint'],
  ['build', 'Build'],
  ['test', 'Tests'],
];

function detectPackageManager(root: string): string {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(root, 'bun.lock')) || existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

async function readScripts(root: string): Promise<Record<string, unknown> | undefined> {
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { scripts?: unknown };
    return typeof pkg.scripts === 'object' && pkg.scripts !== null ? (pkg.scripts as Record<string, unknown>) : {};
  } catch {
    return undefined;
  }
}

/**
 * Builds a starter config from what is actually present in the project, so a
 * healthy project passes immediately and nothing is assumed that cannot be verified.
 */
export async function buildStarterConfig(root: string): Promise<StarterConfig> {
  const checks: JsonCheck[] = [];
  const notes: string[] = [];

  const scripts = await readScripts(root);
  if (scripts) {
    const pm = detectPackageManager(root);
    for (const [script, name] of SCRIPT_CHECKS) {
      if (typeof scripts[script] === 'string') {
        checks.push({ id: script, name, type: 'command', command: `${pm} run ${script}` });
      }
    }
    const found = checks.length;
    notes.push(
      found > 0
        ? `Added ${found} command check(s) from package.json scripts (using ${pm}).`
        : 'package.json has no typecheck/lint/build/test scripts; add command checks manually.',
    );
  } else {
    notes.push('No package.json found; add "command" checks for your build and test tools.');
  }

  const required = ['README.md', 'package.json', 'LICENSE'].filter((file) => existsSync(path.join(root, file)));
  checks.push({
    id: 'required-files',
    name: 'Required files',
    type: 'files',
    mustExist: required.length > 0 ? required : ['README.md'],
  });

  if (existsSync(path.join(root, '.git'))) {
    checks.push({ id: 'git-clean', name: 'Git working tree', type: 'git-clean' });
  } else {
    notes.push('No .git directory found; git checks were not added.');
  }

  notes.push('HTTP and Docker checks are not added automatically; see the README for examples.');
  return { config: { version: 1, checks }, notes };
}
