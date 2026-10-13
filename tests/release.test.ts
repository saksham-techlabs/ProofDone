import assert from 'node:assert/strict';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { commandCheck } from '../src/checks/command/command-check.js';
import { dockerCheck } from '../src/checks/docker/docker-check.js';
import { fileContentCheck } from '../src/checks/files/file-content-check.js';
import { filesCheck } from '../src/checks/files/files-check.js';
import { gitCleanCheck } from '../src/checks/git/git-checks.js';
import { validateConfig } from '../src/config/validate.js';
import { runProcess } from '../src/core/process.js';
import { base, context, git, initRepo, makeTempDir, removeDir, runCliProcess, writeFiles } from './helpers.js';

it('rejects empty file and content rule sets', () => {
  for (const check of [
    { id: 'f', type: 'files', mustExist: [] },
    { id: 'f', type: 'files', mustExist: [], mustNotExist: [] },
    { id: 'f', type: 'file-content', path: 'a', contains: [], notContains: [] },
  ]) assert.equal(validateConfig({ checks: [check] }).config, undefined);
});

it('detects multiline forbidden text and normalizes rule line endings', async () => {
  const root = await makeTempDir();
  try {
    await writeFiles(root, { 'a.txt': 'prefix\r\nBEGIN\r\nSECRET\r\nend' });
    const result = await fileContentCheck.run({
      ...base('f'), type: 'file-content', path: 'a.txt', contains: [],
      notContains: ['begin\nsecret'], ignoreCase: true,
    }, context(root));
    assert.equal(result.status, 'FAIL');
    assert.deepEqual(result.evidence?.missingText, []);
    assert.deepEqual(result.evidence?.forbiddenFound, [{ text: 'begin\nsecret', lines: [2] }]);
    const required = await fileContentCheck.run({
      ...base('f'), type: 'file-content', path: 'a.txt', contains: ['BEGIN\r\nSECRET'], notContains: [], ignoreCase: false,
    }, context(root));
    assert.equal(required.status, 'PASS');
  } finally { await removeDir(root); }
});

it('refuses symlink/junction escapes for content and command working directories', async () => {
  const root = await makeTempDir();
  const project = path.join(root, 'project');
  const outside = path.join(root, 'outside');
  try {
    await mkdir(project);
    await mkdir(outside);
    await writeFile(path.join(outside, 'a.txt'), 'outside evidence');
    await symlink(outside, path.join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const content = await fileContentCheck.run({
      ...base('f'), type: 'file-content', path: 'link/a.txt', contains: ['outside'], notContains: [], ignoreCase: false,
    }, context(project));
    assert.equal(content.status, 'ERROR');
    const command = await commandCheck.run({
      ...base('c'), type: 'command', cwd: 'link', command: 'node -e "process.exit(0)"', env: {}, expectExitCode: 0,
    }, context(project));
    assert.equal(command.status, 'ERROR');
  } finally { await removeDir(root); }
});

it('does not treat a forbidden dangling symlink as an absent path', async () => {
  const root = await makeTempDir();
  try {
    const target = path.join(root, 'target');
    await mkdir(target);
    await symlink(target, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await rm(target, { recursive: true });
    const result = await filesCheck.run({ ...base('f'), type: 'files', mustExist: [], mustNotExist: ['link'] }, context(root));
    assert.notEqual(result.status, 'PASS');
  } finally { await removeDir(root); }
});

it('fails closed when real Git status exceeds the capture limit', async () => {
  const root = await makeTempDir();
  try {
    await initRepo(root);
    await writeFile(path.join(root, 'README.md'), 'staged change');
    git(root, 'add', 'README.md');
    for (let i = 0; i < 1600; i++) {
      await writeFile(path.join(root, `${String(i).padStart(4, '0')}-${'x'.repeat(175)}`), '');
    }
    const result = await gitCleanCheck.run({ ...base('g'), type: 'git-clean', allowUntracked: true }, context(root));
    assert.equal(result.status, 'ERROR');
    assert.match(result.summary, /truncated/);
  } finally { await removeDir(root); }
});

it('rejects empty and malformed Docker state instead of passing existence', async () => {
  const root = await makeTempDir();
  try {
  const script = path.join(root, 'docker.cjs');
  for (const state of [{}, [], null, { Running: 'true', Status: 'running' }]) {
    await writeFile(script, `console.log(${JSON.stringify(JSON.stringify(state))})`);
    const result = await dockerCheck.run({ ...base('d'), type: 'docker', container: 'web', expect: 'exists' },
      context(root, { docker: { command: process.execPath, args: [script] } }));
    assert.equal(result.status, 'ERROR');
  }
  } finally { await removeDir(root); }
});

it('does not emit terminal control sequences from config names in plain output', async () => {
  const root = await makeTempDir();
  try {
    await writeFiles(root, { 'proofdone.config.json': JSON.stringify({ checks: [
      { id: 'f', name: '\u001b[2Jforged\u0007', type: 'files', mustExist: ['proofdone.config.json'] },
    ] }) });
    const result = await runCliProcess(['verify', '--no-color'], root, { FORCE_COLOR: '1' });
    assert.equal(result.status, 0);
    assert.ok(!(result.stdout + result.stderr).includes('\u001b'));
    assert.ok(!(result.stdout + result.stderr).includes('\u0007'));
  } finally { await removeDir(root); }
});

it('terminates a command descendant on timeout', async () => {
  const root = await makeTempDir();
  try {
    const script = path.join(root, 'parent.cjs');
    await writeFile(script, `const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
console.log(child.pid); setInterval(()=>{},1000);`);
    const result = await runProcess(process.execPath, [script], { cwd: root, timeoutMs: 1500 });
    assert.equal(result.timedOut, true);
    const pid = Number(result.stdout.trim());
    assert.ok(pid > 0, 'descendant must have started');
    // Allow the OS to finish reaping the terminated process.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { await removeDir(root); }
});

it('disables repository-configured Git fsmonitor hooks', async () => {
  const root = await makeTempDir();
  try {
    await initRepo(root);
    const script = path.join(root, '.git', 'monitor.cjs');
    const marker = path.join(root, '.git', 'monitor-ran');
    await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`);
    git(root, 'config', 'core.fsmonitor', `node "${script.replace(/\\/g, '/')}"`);
    const outcome = await gitCleanCheck.run({ ...base('g'), type: 'git-clean', allowUntracked: false }, context(root));
    assert.equal(outcome.status, 'PASS');
    assert.equal(existsSync(marker), false);
  } finally { await removeDir(root); }
});

it('detects dirty submodules even when repository config says to ignore them', async () => {
  const root = await makeTempDir();
  try {
    const source = path.join(root, 'source');
    const project = path.join(root, 'project');
    await mkdir(source);
    await mkdir(project);
    await initRepo(source);
    await initRepo(project);
    git(project, '-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'child');
    git(project, 'commit', '-am', 'add local submodule');
    git(project, 'config', 'submodule.child.ignore', 'all');
    await writeFile(path.join(project, 'child', 'README.md'), 'modified');
    const result = await gitCleanCheck.run({ ...base('g'), type: 'git-clean', allowUntracked: false }, context(project));
    assert.equal(result.status, 'FAIL');
    assert.equal((result.evidence?.counts as { unstaged: number }).unstaged, 1);
  } finally { await removeDir(root); }
});

it('Docker timeout is unavailable, never PASS', async () => {
  const root = await makeTempDir();
  try {
    const script = path.join(root, 'docker.cjs');
    await writeFile(script, 'setInterval(()=>{},1000);');
    const result = await dockerCheck.run({ ...base('d', { timeoutMs: 300 }), type: 'docker', container: 'web', expect: 'exists' },
      context(root, { docker: { command: process.execPath, args: [script] } }));
    assert.equal(result.status, 'NOT_CHECKED');
  } finally { await removeDir(root); }
});

it('verifies the selected project even when parent Git environment points to another repository', async () => {
  const root = await makeTempDir();
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  try {
    const clean = path.join(root, 'clean');
    const dirty = path.join(root, 'dirty');
    await mkdir(clean);
    await mkdir(dirty);
    await initRepo(clean);
    await initRepo(dirty);
    await writeFile(path.join(dirty, 'README.md'), 'uncommitted');
    process.env.GIT_DIR = path.join(clean, '.git');
    process.env.GIT_WORK_TREE = clean;
    const result = await gitCleanCheck.run({ ...base('g'), type: 'git-clean', allowUntracked: false }, context(dirty));
    assert.equal(result.status, 'FAIL');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key); else process.env[key] = value;
    }
    await removeDir(root);
  }
});
