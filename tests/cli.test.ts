import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { VerificationReport } from '../src/types/index.js';
import { VERSION } from '../src/version.js';
import { git, initRepo, makeTempDir, nodeCommand, removeDir, runCliProcess, writeFiles } from './helpers.js';

async function writeConfig(dir: string, checks: unknown[], file = 'proofdone.config.json'): Promise<void> {
  await writeFiles(dir, { [file]: JSON.stringify({ version: 1, checks }, null, 2) });
}

describe('cli: basics', () => {
  it('prints the version', async () => {
    for (const flag of ['--version', '-v']) {
      const result = await runCliProcess([flag], process.cwd());
      assert.equal(result.status, 0);
      assert.equal(result.stdout.trim(), VERSION);
    }
  });

  it('prints help', async () => {
    const result = await runCliProcess(['--help'], process.cwd());
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:\n {2}proofdone <command>/);
    assert.match(result.stdout, /3 {2}UNVERIFIED/);
    const verifyHelp = await runCliProcess(['verify', '--help'], process.cwd());
    assert.equal(verifyHelp.status, 0);
    assert.match(verifyHelp.stdout, /--strict/);
    assert.match(verifyHelp.stdout, /git-upstream/);
  });

  it('exits 2 on usage errors', async () => {
    const none = await runCliProcess([], process.cwd());
    assert.equal(none.status, 2);
    const unknown = await runCliProcess(['deploy'], process.cwd());
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /Unknown command "deploy"/);
    const badFlag = await runCliProcess(['verify', '--fix'], process.cwd());
    assert.equal(badFlag.status, 2);
    assert.match(badFlag.stderr, /--fix/);
    const extra = await runCliProcess(['verify', 'now'], process.cwd());
    assert.equal(extra.status, 2);
  });
});

describe('cli: init', () => {
  let dir: string;
  before(async () => {
    dir = await makeTempDir();
    await writeFiles(dir, {
      'package.json': JSON.stringify({ name: 'demo', scripts: { build: 'tsc', test: 'node --test', dev: 'vite' } }),
      'README.md': '# Demo\n',
      'pnpm-lock.yaml': '',
    });
    git(dir, 'init', '-b', 'main');
  });
  after(async () => {
    await removeDir(dir);
  });

  it('creates a starter config from the project contents', async () => {
    const result = await runCliProcess(['init'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Created .*proofdone\.config\.json with 4 check\(s\)/);
    const config = JSON.parse(await readFile(path.join(dir, 'proofdone.config.json'), 'utf8')) as {
      checks: { id: string; type: string; command?: string; mustExist?: string[] }[];
    };
    assert.deepEqual(
      config.checks.map((c) => c.id),
      ['build', 'test', 'required-files', 'git-clean'],
    );
    assert.equal(config.checks[0]?.command, 'pnpm run build');
    assert.deepEqual(config.checks[2]?.mustExist, ['README.md', 'package.json']);

    const validate = await runCliProcess(['validate'], dir);
    assert.equal(validate.status, 0, validate.stderr);
  });

  it('refuses to overwrite an existing config without --force', async () => {
    const file = path.join(dir, 'proofdone.config.json');
    await writeFile(file, '{"custom": true}');
    const result = await runCliProcess(['init'], dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /already exists\. Nothing was changed\. Use --force/);
    assert.equal(await readFile(file, 'utf8'), '{"custom": true}');

    const forced = await runCliProcess(['init', '--force'], dir);
    assert.equal(forced.status, 0);
    assert.notEqual(await readFile(file, 'utf8'), '{"custom": true}');
  });

  it('works in an empty directory and with --cwd / --config', async () => {
    const empty = await makeTempDir();
    try {
      const result = await runCliProcess(['init', '--cwd', empty, '--config', 'config/pd.json'], process.cwd());
      assert.equal(result.status, 0, result.stderr);
      const config = JSON.parse(await readFile(path.join(empty, 'config', 'pd.json'), 'utf8')) as {
        checks: { type: string; mustExist?: string[] }[];
      };
      assert.deepEqual(config.checks, [
        { id: 'required-files', name: 'Required files', type: 'files', mustExist: ['README.md'] },
      ]);
    } finally {
      await removeDir(empty);
    }
  });
});

describe('cli: verify', () => {
  let dir: string;
  before(async () => {
    dir = await makeTempDir();
    await initRepo(dir, { 'README.md': '# Demo\n', 'src/app.js': 'console.log(1);\n', '.gitignore': 'out.txt\n' });
  });
  after(async () => {
    await removeDir(dir);
  });

  async function commitConfig(checks: unknown[]): Promise<void> {
    await writeConfig(dir, checks);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'config');
  }

  it('exits 0 with verdict DONE when all required checks pass', async () => {
    await commitConfig([
      { id: 'build', name: 'Build', type: 'command', command: nodeCommand("console.log('built')") },
      { id: 'files', name: 'Required files', type: 'files', mustExist: ['README.md', 'src/app.js'] },
      { id: 'clean', name: 'Git working tree', type: 'git-clean' },
      { id: 'docker', name: 'Docker', type: 'docker', container: 'proofdone-test-none', required: false },
    ]);
    const result = await runCliProcess(['verify'], dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Build\s+PASS/);
    assert.match(result.stdout, /Final verdict: DONE/);
    assert.match(result.stderr, /\[1\/4\] Build \.\.\./);

    const status = git(dir, 'status', '--porcelain');
    assert.equal(status, '', 'verify must not modify the project');
  });

  it('exits 1 with verdict NOT DONE and evidence when a required check fails', async () => {
    await commitConfig([
      { id: 'build', name: 'Build', type: 'command', command: nodeCommand("console.error('Type error in src/app.js'); process.exit(2)") },
      { id: 'clean', name: 'Git working tree', type: 'git-clean' },
    ]);
    await writeFile(path.join(dir, 'src', 'app.js'), 'console.log(2);\n');
    try {
      const result = await runCliProcess(['verify', '--quiet'], dir);
      assert.equal(result.status, 1);
      assert.equal(result.stderr, '', '--quiet suppresses progress');
      assert.match(result.stdout, /Build\s+FAIL\s+exit 2 \(expected 0\)/);
      assert.match(result.stdout, /Type error in src\/app\.js/);
      assert.match(result.stdout, /unstaged: src\/app\.js/);
      assert.match(result.stdout, /Final verdict: NOT DONE\nReason: 2 required checks failed/);
    } finally {
      git(dir, 'checkout', '--', 'src/app.js');
    }
  });

  it('exits 3 with verdict UNVERIFIED when a required check cannot be verified', async () => {
    await commitConfig([
      { id: 'files', type: 'files', mustExist: ['README.md'] },
      { id: 'pushed', name: 'Pushed to remote', type: 'git-upstream' },
    ]);
    const result = await runCliProcess(['verify'], dir);
    assert.equal(result.status, 3);
    assert.match(result.stdout, /Pushed to remote\s+NOT CHECKED\s+branch main has no upstream/);
    assert.match(result.stdout, /Final verdict: UNVERIFIED/);
  });

  it('prints a JSON report with --json', async () => {
    await commitConfig([
      { id: 'build', type: 'command', command: nodeCommand("console.log('ok')") },
      { id: 'missing', type: 'files', mustExist: ['LICENSE'] },
    ]);
    const result = await runCliProcess(['verify', '--json'], dir);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '', 'JSON mode prints no progress');
    const report = JSON.parse(result.stdout) as VerificationReport & { exitCode: number };
    assert.equal(report.verdict, 'NOT_DONE');
    assert.equal(report.exitCode, 1);
    assert.equal(report.version, VERSION);
    assert.equal(report.projectRoot, dir);
    assert.equal(report.checks[0]?.status, 'PASS');
    assert.equal(report.checks[0]?.evidence.exitCode, 0);
    assert.deepEqual(report.checks[1]?.evidence.missing, ['LICENSE']);
  });

  it('runs a subset with --only and rejects unknown ids', async () => {
    const result = await runCliProcess(['verify', '--only', 'build', '--json'], dir);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout) as VerificationReport;
    assert.deepEqual(report.only, ['build']);
    assert.equal(report.checks.length, 1);
    const bad = await runCliProcess(['verify', '--only', 'nope'], dir);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Unknown check id\(s\) for --only: nope/);
  });

  it('treats warnings as failures with --strict', async () => {
    await commitConfig([{ id: 'clean', type: 'git-clean', allowUntracked: true }]);
    await writeFile(path.join(dir, 'scratch.txt'), 'x');
    try {
      const normal = await runCliProcess(['verify'], dir);
      assert.equal(normal.status, 0);
      assert.match(normal.stdout, /WARNING/);
      const strict = await runCliProcess(['verify', '--strict'], dir);
      assert.equal(strict.status, 1);
      assert.match(strict.stdout, /Strict mode/);
    } finally {
      git(dir, 'clean', '-fq');
    }
  });

  it('resolves paths relative to the config file location', async () => {
    await writeConfig(dir, [{ id: 'f', type: 'files', mustExist: ['../README.md'] }], 'nested/pd.json');
    const escaping = await runCliProcess(['verify', '--config', 'nested/pd.json'], dir);
    assert.equal(escaping.status, 2, 'paths may not escape the config directory');
    await writeConfig(dir, [{ id: 'f', type: 'files', mustExist: ['pd.json'] }], 'nested/pd.json');
    const ok = await runCliProcess(['verify', '--config', 'nested/pd.json'], dir);
    assert.equal(ok.status, 0, ok.stdout);
    git(dir, 'clean', '-fdq');
  });

  it('verifies a real local HTTP service end-to-end', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end('{"status":"ok"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      await writeConfig(dir, [
        { id: 'health', type: 'http', url: `http://127.0.0.1:${port}/api/health`, bodyContains: '"ok"' },
      ]);
      const result = await runCliProcess(['verify', '--json'], dir);
      assert.equal(result.status, 0, result.stdout);
      const report = JSON.parse(result.stdout) as VerificationReport;
      assert.equal(report.checks[0]?.evidence.status, 200);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      git(dir, 'checkout', '--', 'proofdone.config.json');
    }
  });
});

describe('cli: configuration errors', () => {
  let dir: string;
  before(async () => {
    dir = await makeTempDir();
  });
  after(async () => {
    await removeDir(dir);
  });

  it('exits 2 when the config is missing', async () => {
    const result = await runCliProcess(['verify'], dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /No config found .*proofdone init/);
  });

  it('exits 2 with helpful issues for an invalid config', async () => {
    await writeConfig(dir, [{ id: 'build', type: 'comand', command: 'npm run build' }, { type: 'files' }]);
    const result = await runCliProcess(['verify'], dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /checks\[0\]\.type: unknown check type "comand"/);
    assert.match(result.stderr, /checks\[1\]\.id: is required/);

    const json = await runCliProcess(['verify', '--json'], dir);
    assert.equal(json.status, 2);
    const payload = JSON.parse(json.stdout) as { error: { code: string; issues: unknown[] } };
    assert.equal(payload.error.code, 'CONFIG_INVALID');
    assert.equal(payload.error.issues.length, 3);
  });

  it('validate lists commands without executing them', async () => {
    await writeConfig(dir, [
      { id: 'danger', type: 'command', command: nodeCommand("require('fs').writeFileSync('marker.txt', 'x')") },
      { id: 'site', type: 'http', url: 'http://localhost:3000/health', required: false },
    ]);
    const result = await runCliProcess(['validate'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /will execute these commands:\n {2}\(\.\) node -e/);
    assert.match(result.stdout, /site \[http, optional\]: GET http:\/\/localhost:3000\/health returns a 2xx status/);
    assert.equal(existsSync(path.join(dir, 'marker.txt')), false);

    const json = await runCliProcess(['validate', '--json'], dir);
    const payload = JSON.parse(json.stdout) as { valid: boolean; commands: { id: string }[] };
    assert.equal(payload.valid, true);
    assert.deepEqual(
      payload.commands.map((c) => c.id),
      ['danger'],
    );
  });
});
