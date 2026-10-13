import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { gitBranchCheck, gitCleanCheck, gitRepoCheck, gitUpstreamCheck } from '../src/checks/git/git-checks.js';
import { parsePorcelainV2 } from '../src/checks/git/git-status.js';
import type { GitCleanCheckConfig, GitUpstreamCheckConfig } from '../src/types/index.js';
import { base, context, git, initRepo, makeTempDir, removeDir, writeFiles } from './helpers.js';

const clean = (allowUntracked = false): GitCleanCheckConfig => ({ ...base('clean'), type: 'git-clean', allowUntracked });
const upstream = (extra: Partial<GitUpstreamCheckConfig> = {}): GitUpstreamCheckConfig => ({
  ...base('up'),
  type: 'git-upstream',
  allowAhead: false,
  allowBehind: false,
  ...extra,
});

describe('git porcelain v2 parser', () => {
  it('parses branch headers and every entry kind', () => {
    const output = [
      '# branch.oid 1234567890abcdef1234567890abcdef12345678',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaa bbb src/staged file.ts',
      '1 .M N... 100644 100644 100644 aaa bbb src/unstaged.ts',
      '1 MM N... 100644 100644 100644 aaa bbb both.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts',
      'old name.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
      '? new file.txt',
      '',
    ].join('\0');
    const status = parsePorcelainV2(output);
    assert.equal(status.branch, 'feature/x');
    assert.equal(status.head, '1234567890abcdef1234567890abcdef12345678');
    assert.equal(status.upstream, 'origin/feature/x');
    assert.equal(status.ahead, 2);
    assert.equal(status.behind, 1);
    assert.deepEqual(status.staged, ['src/staged file.ts', 'both.ts', 'new name.ts']);
    assert.deepEqual(status.unstaged, ['src/unstaged.ts', 'both.ts']);
    assert.deepEqual(status.conflicted, ['conflict.ts']);
    assert.deepEqual(status.untracked, ['new file.txt']);
  });

  it('handles detached HEAD and repositories without commits', () => {
    const detached = parsePorcelainV2('# branch.oid abc\0# branch.head (detached)\0');
    assert.equal(detached.branch, null);
    const fresh = parsePorcelainV2('# branch.oid (initial)\0# branch.head main\0');
    assert.equal(fresh.head, null);
    assert.equal(fresh.upstream, null);
  });
});

describe('git checks (real repositories)', () => {
  let repo: string;
  const savedCeiling = process.env.GIT_CEILING_DIRECTORIES;

  before(async () => {
    repo = await makeTempDir();
    await initRepo(repo, { 'README.md': '# Demo\n', 'src/index.ts': 'export const a = 1;\n' });
  });
  after(async () => {
    await removeDir(repo);
  });
  afterEach(() => {
    git(repo, 'reset', '--hard', '-q');
    git(repo, 'clean', '-fdq');
    if (savedCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = savedCeiling;
  });

  it('git-repo passes and reports branch and repository root', async () => {
    const outcome = await gitRepoCheck.run({ ...base('repo'), type: 'git-repo' }, context(repo));
    assert.equal(outcome.status, 'PASS');
    assert.match(outcome.summary, /git repository on main \([0-9a-f]{7}\)/);
    assert.equal(path.resolve(String(outcome.evidence?.repositoryRoot)), path.resolve(repo));
  });

  it('git-clean passes on a clean working tree', async () => {
    const outcome = await gitCleanCheck.run(clean(), context(repo));
    assert.equal(outcome.status, 'PASS');
    assert.equal(outcome.summary, 'working tree clean on main');
  });

  it('git-clean fails with unstaged changes and lists them', async () => {
    await writeFile(path.join(repo, 'src', 'index.ts'), 'export const a = 2;\n');
    const outcome = await gitCleanCheck.run(clean(), context(repo));
    assert.equal(outcome.status, 'FAIL');
    assert.match(outcome.summary, /1 unstaged/);
    assert.deepEqual(outcome.details, ['unstaged: src/index.ts']);
  });

  it('git-clean fails with staged changes', async () => {
    await writeFile(path.join(repo, 'README.md'), '# Changed\n');
    git(repo, 'add', 'README.md');
    const outcome = await gitCleanCheck.run(clean(), context(repo));
    assert.equal(outcome.status, 'FAIL');
    assert.match(outcome.summary, /1 staged/);
  });

  it('git-clean fails on untracked files by default and warns when allowed', async () => {
    await writeFiles(repo, { 'notes/new file.md': 'draft' });
    const strict = await gitCleanCheck.run(clean(), context(repo));
    assert.equal(strict.status, 'FAIL');
    assert.deepEqual(strict.details, ['untracked: notes/new file.md']);
    const lenient = await gitCleanCheck.run(clean(true), context(repo));
    assert.equal(lenient.status, 'WARNING');
  });

  it('git status does not modify the repository index', async () => {
    const indexPath = path.join(repo, '.git', 'index');
    const before = await readFile(indexPath);
    await gitCleanCheck.run(clean(), context(repo));
    assert.deepEqual(await readFile(indexPath), before);
  });

  it('git-branch compares the current branch', async () => {
    const ok = await gitBranchCheck.run({ ...base('b'), type: 'git-branch', expected: 'main' }, context(repo));
    assert.equal(ok.status, 'PASS');
    const wrong = await gitBranchCheck.run({ ...base('b'), type: 'git-branch', expected: 'release' }, context(repo));
    assert.equal(wrong.status, 'FAIL');
    assert.equal(wrong.summary, 'on main, expected release');
  });

  it('git-upstream is NOT_CHECKED without an upstream (never PASS)', async () => {
    const outcome = await gitUpstreamCheck.run(upstream(), context(repo));
    assert.equal(outcome.status, 'NOT_CHECKED');
    assert.match(outcome.summary, /no upstream/);
  });

  it('reports NOT_CHECKED when git is unavailable', async () => {
    const tools = { git: { command: 'proofdone-missing-git-binary', args: [] } };
    for (const outcome of [
      await gitCleanCheck.run(clean(), context(repo, tools)),
      await gitRepoCheck.run({ ...base('r'), type: 'git-repo' }, context(repo, tools)),
    ]) {
      assert.equal(outcome.status, 'NOT_CHECKED');
      assert.match(outcome.summary, /git is not installed/);
    }
  });

  it('fails when the project is not a git repository', async () => {
    const plain = await makeTempDir();
    try {
      process.env.GIT_CEILING_DIRECTORIES = path.dirname(plain);
      const outcome = await gitCleanCheck.run(clean(), context(plain));
      assert.equal(outcome.status, 'FAIL');
      assert.match(outcome.summary, /not inside a git repository/);
    } finally {
      await removeDir(plain);
    }
  });
});

describe('git-upstream (real remote)', () => {
  let root: string;
  let work: string;

  before(async () => {
    root = await makeTempDir();
    const remote = path.join(root, 'remote.git');
    work = path.join(root, 'work');
    git(root, 'init', '--bare', '-b', 'main', remote);
    git(root, 'init', '-b', 'main', work);
    await initRepo(work);
    git(work, 'remote', 'add', 'origin', remote);
    // Model the last fetched state entirely locally; tests never need to push.
    git(work, 'update-ref', 'refs/remotes/origin/main', git(work, 'rev-parse', 'HEAD').trim());
    git(work, 'config', 'branch.main.remote', 'origin');
    git(work, 'config', 'branch.main.merge', 'refs/heads/main');
  });
  after(async () => {
    await removeDir(root);
  });

  it('passes when in sync with the upstream', async () => {
    const outcome = await gitUpstreamCheck.run(upstream(), context(work));
    assert.equal(outcome.status, 'PASS');
    assert.equal(outcome.summary, 'in sync with origin/main');
  });

  it('fails with unpushed commits unless allowAhead', async () => {
    await writeFiles(work, { 'feature.txt': 'new' });
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'feature', '-q');
    const outcome = await gitUpstreamCheck.run(upstream(), context(work));
    assert.equal(outcome.status, 'FAIL');
    assert.match(outcome.summary, /1 commit\(s\) not pushed/);
    assert.equal(outcome.evidence?.ahead, 1);
    const allowed = await gitUpstreamCheck.run(upstream({ allowAhead: true }), context(work));
    assert.equal(allowed.status, 'PASS');
  });

  it('detects behind and diverged local tracking refs without network access', async () => {
    const local = git(work, 'rev-parse', 'HEAD').trim();
    const previous = git(work, 'rev-parse', 'HEAD^').trim();
    git(work, 'update-ref', 'refs/remotes/origin/main', local);
    git(work, 'reset', '--hard', previous);
    assert.equal((await gitUpstreamCheck.run(upstream(), context(work))).status, 'FAIL');
    assert.equal((await gitUpstreamCheck.run(upstream({ allowBehind: true }), context(work))).status, 'PASS');
    await writeFiles(work, { 'different.txt': 'different' });
    git(work, 'add', '-A');
    git(work, 'commit', '-m', 'diverged', '-q');
    const diverged = await gitUpstreamCheck.run(upstream(), context(work));
    assert.equal(diverged.status, 'FAIL');
    assert.equal(diverged.evidence?.ahead, 1);
    assert.equal(diverged.evidence?.behind, 1);
    git(work, 'update-ref', '-d', 'refs/remotes/origin/main');
    assert.equal((await gitUpstreamCheck.run(upstream(), context(work))).status, 'NOT_CHECKED');
    git(work, 'checkout', '--detach');
    assert.equal((await gitUpstreamCheck.run(upstream(), context(work))).status, 'NOT_CHECKED');
  });
});
