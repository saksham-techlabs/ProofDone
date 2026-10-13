import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadConfig } from '../src/config/load.js';
import { validateConfig } from '../src/config/validate.js';
import { ProofDoneError } from '../src/core/errors.js';
import { makeTempDir, removeDir } from './helpers.js';

function issuesFor(raw: unknown): string[] {
  const { config, issues } = validateConfig(raw);
  if (issues.length > 0) assert.equal(config, undefined, 'config must be withheld when there are issues');
  return issues.map((issue) => `${issue.path}: ${issue.message}`);
}

function checkIssues(check: Record<string, unknown>): string[] {
  return issuesFor({ checks: [check] });
}

describe('config validation', () => {
  it('accepts every check type and applies defaults', () => {
    const { config, issues } = validateConfig({
      $schema: './node_modules/proofdone/schema/proofdone.schema.json',
      version: 1,
      checks: [
        { id: 'build', type: 'command', command: 'npm run build' },
        { id: 'repo', type: 'git-repo' },
        { id: 'clean', type: 'git-clean', allowUntracked: true },
        { id: 'branch', type: 'git-branch', expected: 'main' },
        { id: 'pushed', type: 'git-upstream' },
        { id: 'files', type: 'files', mustExist: ['README.md'], mustNotExist: ['.env'] },
        { id: 'readme', type: 'file-content', path: 'README.md', notContains: ['TODO'] },
        { id: 'health', type: 'http', url: 'http://localhost:3000/health', expectStatus: [200, 204] },
        { id: 'db', type: 'docker', container: 'db', expect: 'healthy', required: false },
      ],
    });
    assert.deepEqual(issues, []);
    assert.ok(config);
    assert.equal(config.checks.length, 9);
    const [build, , clean, , pushed, , readme, health, db] = config.checks;
    assert.deepEqual(build, {
      id: 'build',
      name: 'build',
      required: true,
      type: 'command',
      command: 'npm run build',
      env: {},
      expectExitCode: 0,
    });
    assert.equal(clean?.type === 'git-clean' && clean.allowUntracked, true);
    assert.equal(pushed?.type === 'git-upstream' && pushed.allowAhead, false);
    assert.equal(readme?.type === 'file-content' && readme.ignoreCase, false);
    assert.deepEqual(health?.type === 'http' && health.expectStatus, [200, 204]);
    assert.equal(health?.type === 'http' && health.method, 'GET');
    assert.equal(db?.required, false);
  });

  it('uses the name field as the display name', () => {
    const { config } = validateConfig({ checks: [{ id: 'build', name: 'Build', type: 'command', command: 'x' }] });
    assert.equal(config?.checks[0]?.name, 'Build');
  });

  it('rejects non-object configs and missing or empty checks', () => {
    assert.match(issuesFor([])[0] ?? '', /must be a JSON object/);
    assert.match(issuesFor({})[0] ?? '', /checks: is required/);
    assert.match(issuesFor({ checks: [] })[0] ?? '', /at least one check/);
    assert.match(issuesFor({ checks: ['build'] })[0] ?? '', /checks\[0\]: must be an object/);
  });

  it('rejects unsupported versions and unknown top-level keys', () => {
    const issues = issuesFor({ version: 2, chekcs: [], checks: [{ id: 'a', type: 'git-repo' }] });
    assert.ok(issues.some((i) => i.includes('version') && i.includes('unsupported')));
    assert.ok(issues.some((i) => i.includes('chekcs') && i.includes('not a recognized option')));
  });

  it('reports unknown and missing check types with the valid list', () => {
    assert.match(checkIssues({ id: 'a', type: 'lint' })[0] ?? '', /unknown check type "lint".*command/);
    assert.match(checkIssues({ id: 'a' })[0] ?? '', /type: is required/);
  });

  it('validates ids: required, format and uniqueness', () => {
    assert.ok(checkIssues({ type: 'git-repo' }).some((i) => i.includes('id: is required')));
    assert.ok(checkIssues({ id: 'has space', type: 'git-repo' }).some((i) => i.includes('id: must be')));
    const dupes = issuesFor({
      checks: [
        { id: 'same', type: 'git-repo' },
        { id: 'same', type: 'git-clean' },
      ],
    });
    assert.ok(dupes.some((i) => i.includes('duplicate check id "same"')));
  });

  it('rejects unknown keys on checks (catches typos)', () => {
    const issues = checkIssues({ id: 'build', type: 'command', comand: 'npm test', command: 'npm test' });
    assert.deepEqual(issues, ['checks[0].comand: is not a recognized option']);
  });

  it('validates field types', () => {
    assert.ok(checkIssues({ id: 'a', type: 'command' }).some((i) => i.includes('command: is required')));
    assert.ok(checkIssues({ id: 'a', type: 'command', command: '' }).some((i) => i.includes('non-empty string')));
    assert.ok(checkIssues({ id: 'a', type: 'git-repo', required: 'yes' }).some((i) => i.includes('true or false')));
    assert.ok(checkIssues({ id: 'a', type: 'git-repo', timeoutMs: 0 }).some((i) => i.includes('timeoutMs')));
    assert.ok(
      checkIssues({ id: 'a', type: 'command', command: 'x', env: { A: 1 } }).some((i) => i.includes('env.A: must be a string')),
    );
    assert.ok(checkIssues({ id: 'a', type: 'git-branch' }).some((i) => i.includes('expected: is required')));
    assert.ok(checkIssues({ id: 'a', type: 'docker', container: 'x', expect: 'up' }).some((i) => i.includes('one of')));
  });

  it('requires at least one rule for files and file-content checks', () => {
    assert.ok(checkIssues({ id: 'a', type: 'files' }).some((i) => i.includes('mustExist')));
    assert.ok(checkIssues({ id: 'a', type: 'file-content', path: 'README.md' }).some((i) => i.includes('contains')));
  });

  it('rejects absolute paths and paths escaping the project root', () => {
    const abs = checkIssues({ id: 'a', type: 'files', mustExist: ['/etc/passwd'] });
    assert.ok(abs.some((i) => i.includes('absolute paths are not allowed')));
    const win = checkIssues({ id: 'a', type: 'files', mustExist: ['C:\\Windows\\win.ini'] });
    assert.ok(win.some((i) => i.includes('absolute paths are not allowed')));
    const escape = checkIssues({ id: 'a', type: 'file-content', path: '../secrets.txt', contains: ['x'] });
    assert.ok(escape.some((i) => i.includes('inside the project root')));
    const cwd = checkIssues({ id: 'a', type: 'command', command: 'x', cwd: 'sub/../../other' });
    assert.ok(cwd.some((i) => i.includes('inside the project root')));
  });

  it('normalizes Windows-style relative paths to forward slashes', () => {
    const { config } = validateConfig({
      checks: [{ id: 'a', type: 'files', mustExist: ['docs\\guide.md', './src//index.ts', 'dir/'] }],
    });
    const check = config?.checks[0];
    assert.deepEqual(check?.type === 'files' && check.mustExist, ['docs/guide.md', 'src/index.ts', 'dir']);
  });

  it('validates http options', () => {
    assert.ok(checkIssues({ id: 'a', type: 'http', url: 'localhost:3000' }).some((i) => i.includes('http or https')));
    assert.ok(checkIssues({ id: 'a', type: 'http', url: 'not a url' }).some((i) => i.includes('valid absolute URL')));
    assert.ok(checkIssues({ id: 'a', type: 'http', url: 'ftp://example.com' }).some((i) => i.includes('http or https')));
    assert.ok(
      checkIssues({ id: 'a', type: 'http', url: 'http://x', expectStatus: [200, 700] }).some((i) => i.includes('expectStatus')),
    );
    assert.ok(checkIssues({ id: 'a', type: 'http', url: 'http://x', expectStatus: [] }).some((i) => i.includes('expectStatus')));
    assert.ok(checkIssues({ id: 'a', type: 'http', url: 'http://x', method: 'POST' }).some((i) => i.includes('GET, HEAD')));
    assert.ok(
      checkIssues({ id: 'a', type: 'http', url: 'http://x', method: 'HEAD', bodyContains: 'ok' }).some((i) =>
        i.includes('cannot be used with method HEAD'),
      ),
    );
    const { config } = validateConfig({ checks: [{ id: 'a', type: 'http', url: 'http://x', expectStatus: 204 }] });
    const check = config?.checks[0];
    assert.deepEqual(check?.type === 'http' && check.expectStatus, [204]);
  });

  it('collects multiple issues in one pass', () => {
    const issues = issuesFor({
      checks: [
        { id: 'a', type: 'command' },
        { id: 'b', type: 'http' },
        { id: 'c', type: 'nope' },
      ],
    });
    assert.equal(issues.length, 3);
  });
});

describe('config loading', () => {
  let dir: string;
  before(async () => {
    dir = await makeTempDir();
  });
  after(async () => {
    await removeDir(dir);
  });

  it('reports a missing config with a hint to run init', async () => {
    await assert.rejects(loadConfig(path.join(dir, 'missing.json')), (error: unknown) => {
      assert.ok(error instanceof ProofDoneError);
      assert.equal(error.code, 'CONFIG_NOT_FOUND');
      assert.match(error.message, /proofdone init/);
      return true;
    });
  });

  it('reports invalid JSON', async () => {
    const file = path.join(dir, 'bad.json');
    await writeFile(file, '{ "checks": [ }');
    await assert.rejects(loadConfig(file), (error: unknown) => error instanceof ProofDoneError && error.code === 'CONFIG_PARSE');
  });

  it('reports schema issues', async () => {
    const file = path.join(dir, 'invalid.json');
    await writeFile(file, JSON.stringify({ checks: [{ id: 'x', type: 'command' }] }));
    await assert.rejects(loadConfig(file), (error: unknown) => {
      assert.ok(error instanceof ProofDoneError);
      assert.equal(error.code, 'CONFIG_INVALID');
      assert.equal(error.issues[0]?.path, 'checks[0].command');
      return true;
    });
  });

  it('accepts a UTF-8 BOM and uses the config directory as project root', async () => {
    const file = path.join(dir, 'bom.json');
    await writeFile(file, `\uFEFF${JSON.stringify({ checks: [{ id: 'repo', type: 'git-repo' }] })}`);
    const loaded = await loadConfig(file);
    assert.equal(loaded.projectRoot, dir);
    assert.equal(loaded.config.checks[0]?.id, 'repo');
  });
});
