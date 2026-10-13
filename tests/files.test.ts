import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MAX_CONTENT_FILE_BYTES, fileContentCheck } from '../src/checks/files/file-content-check.js';
import { filesCheck } from '../src/checks/files/files-check.js';
import { validateConfig } from '../src/config/validate.js';
import type { FileContentCheckConfig, FilesCheckConfig } from '../src/types/index.js';
import { base, context, makeTempDir, removeDir, writeFiles } from './helpers.js';

const files = (mustExist: string[], mustNotExist: string[] = []): FilesCheckConfig => ({
  ...base('files'),
  type: 'files',
  mustExist,
  mustNotExist,
});

const content = (extra: Partial<FileContentCheckConfig>): FileContentCheckConfig => ({
  ...base('content'),
  type: 'file-content',
  path: 'README.md',
  contains: [],
  notContains: [],
  ignoreCase: false,
  ...extra,
});

describe('files check', () => {
  let dir: string;
  before(async () => {
    dir = await makeTempDir();
    await writeFiles(dir, {
      'README.md': '# Project\n',
      'package.json': '{}',
      'docs/guide/intro.md': 'intro',
      '.env.example': 'KEY=',
    });
  });
  after(async () => {
    await removeDir(dir);
  });

  it('passes when required files and directories exist', async () => {
    const outcome = await filesCheck.run(files(['README.md', 'package.json', 'docs', '.env.example']), context(dir));
    assert.equal(outcome.status, 'PASS');
    assert.equal(outcome.summary, 'all 4 path rule(s) satisfied');
  });

  it('fails and lists missing files', async () => {
    const outcome = await filesCheck.run(files(['README.md', 'LICENSE', 'docs/missing.md']), context(dir));
    assert.equal(outcome.status, 'FAIL');
    assert.equal(outcome.summary, '2 missing');
    assert.deepEqual(outcome.evidence?.missing, ['LICENSE', 'docs/missing.md']);
  });

  it('supports mustNotExist', async () => {
    const ok = await filesCheck.run(files([], ['.env', 'debug.log']), context(dir));
    assert.equal(ok.status, 'PASS');
    const bad = await filesCheck.run(files([], ['.env.example']), context(dir));
    assert.equal(bad.status, 'FAIL');
    assert.equal(bad.summary, '1 present but forbidden');
  });

  it('resolves Windows-style config paths on every platform', async () => {
    const { config } = validateConfig({ checks: [{ id: 'f', type: 'files', mustExist: ['docs\\guide\\intro.md'] }] });
    const check = config?.checks[0];
    assert.ok(check?.type === 'files');
    const outcome = await filesCheck.run(check, context(dir));
    assert.equal(outcome.status, 'PASS');
  });

  it('warns about letter-case mismatches that would break on Linux', async () => {
    const outcome = await filesCheck.run(files(['readme.md', 'DOCS/guide/intro.md']), context(dir));
    assert.equal(outcome.status, 'WARNING');
    assert.ok(outcome.details?.some((line) => line.includes('found README.md')));
    assert.ok(outcome.details?.some((line) => line.includes('found docs/guide/intro.md')));
  });

  it('treats a file used as a directory as missing', async () => {
    const outcome = await filesCheck.run(files(['README.md/child']), context(dir));
    assert.equal(outcome.status, 'FAIL');
  });
});

describe('file-content check', () => {
  let dir: string;
  before(async () => {
    dir = await makeTempDir();
    await writeFiles(dir, {
      'README.md': '# Project\r\n\r\nInstall with npm.\r\nTODO: write docs\r\n',
      'src/config.ts': 'export const apiKey = process.env.API_KEY;\n// todo later\n',
    });
  });
  after(async () => {
    await removeDir(dir);
  });

  it('passes when required text is present and forbidden text absent', async () => {
    const outcome = await fileContentCheck.run(
      content({ path: 'src/config.ts', contains: ['process.env.API_KEY'], notContains: ['sk-live', 'FIXME'] }),
      context(dir),
    );
    assert.equal(outcome.status, 'PASS');
  });

  it('fails when required text is missing', async () => {
    const outcome = await fileContentCheck.run(content({ contains: ['## License'] }), context(dir));
    assert.equal(outcome.status, 'FAIL');
    assert.deepEqual(outcome.evidence?.missingText, ['## License']);
  });

  it('reports forbidden text with line numbers (CRLF aware) but not line content', async () => {
    const outcome = await fileContentCheck.run(content({ notContains: ['TODO'] }), context(dir));
    assert.equal(outcome.status, 'FAIL');
    assert.deepEqual(outcome.evidence?.forbiddenFound, [{ text: 'TODO', lines: [4] }]);
    assert.ok(!JSON.stringify(outcome).includes('write docs'));
  });

  it('supports case-insensitive matching', async () => {
    const sensitive = await fileContentCheck.run(content({ path: 'src/config.ts', notContains: ['TODO'] }), context(dir));
    assert.equal(sensitive.status, 'PASS');
    const insensitive = await fileContentCheck.run(
      content({ path: 'src/config.ts', notContains: ['TODO'], ignoreCase: true }),
      context(dir),
    );
    assert.equal(insensitive.status, 'FAIL');
  });

  it('fails when the file does not exist', async () => {
    const outcome = await fileContentCheck.run(content({ path: 'CHANGELOG.md', notContains: ['x'] }), context(dir));
    assert.equal(outcome.status, 'FAIL');
    assert.match(outcome.summary, /file not found/);
  });

  it('errors on directories and oversized files instead of guessing', async () => {
    const directory = await fileContentCheck.run(content({ path: 'src', contains: ['x'] }), context(dir));
    assert.equal(directory.status, 'ERROR');
    await writeFile(path.join(dir, 'big.log'), Buffer.alloc(MAX_CONTENT_FILE_BYTES + 1, 'a'));
    const big = await fileContentCheck.run(content({ path: 'big.log', notContains: ['x'] }), context(dir));
    assert.equal(big.status, 'ERROR');
    assert.match(big.summary, /larger than 5 MB/);
  });
});
