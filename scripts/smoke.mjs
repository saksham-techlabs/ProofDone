// Build, pack, install and exercise the actual npm executable without publication.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this script with npm run smoke');
function run(command, args, options = {}, expected = 0) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120_000, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return result.stdout;
}
const npm = (args, options) => run(process.execPath, [npmCli, ...args], options);
npm(['run', 'build']);
mkdirSync(path.join(root, '.test-build'), { recursive: true });
const temp = mkdtempSync(path.join(root, '.test-build', 'package-smoke-'));
try {
  const pack = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp]));
  const entries = pack[0].files.map((entry) => entry.path);
  for (const file of ['dist/cli/main.js', 'dist/index.js', 'dist/index.d.ts', 'schema/proofdone.schema.json', 'LICENSE', 'SECURITY.md', 'docs/configuration.md']) {
    assert.ok(entries.includes(file), `package missing ${file}`);
  }
  assert.ok(entries.every((entry) => !/^(src|tests|node_modules|\.git|\.audit)\//.test(entry)), 'unexpected development/private package contents');
  const install = path.join(temp, 'installed');
  mkdirSync(install);
  writeFileSync(path.join(install, 'package.json'), '{"private":true}');
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(temp, 'cache'), path.join(temp, pack[0].filename)], { cwd: install });
  const shim = path.join(install, 'node_modules', '.bin', process.platform === 'win32' ? 'proofdone.cmd' : 'proofdone');
  const fixture = path.join(temp, 'project with spaces');
  mkdirSync(fixture);
  writeFileSync(path.join(fixture, 'README.md'), '# Package smoke\n');
  // Arguments below are fixed flags only; no user/config text enters this shell command.
  const cli = (args, expected = 0) => run(process.platform === 'win32' ? `"${shim}" ${args.join(' ')}` : shim,
    process.platform === 'win32' ? [] : args,
    { cwd: fixture, shell: process.platform === 'win32' }, expected);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(cli(['--version']).trim(), pkg.version);
  assert.match(cli(['--help']), /Usage:/);
  cli(['init']);
  assert.equal(JSON.parse(cli(['validate', '--json'])).valid, true);
  assert.equal(JSON.parse(cli(['verify', '--json'])).verdict, 'DONE');
  rmSync(path.join(fixture, 'README.md'));
  const failed = JSON.parse(cli(['verify', '--json'], 1));
  assert.equal(failed.verdict, 'NOT_DONE');
  assert.equal(failed.checks[0].status, 'FAIL');
  console.log(`Package smoke passed: ${entries.length} files; installed executable, help, version, init, validate, PASS and FAIL verified.`);
} finally {
  const relative = path.relative(root, temp);
  assert.ok(relative.startsWith(`.test-build${path.sep}`) && !path.isAbsolute(relative));
  rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
}
