import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { capList, formatDuration, redact, REDACTED, sanitizeOutput, stripAnsi, tailLines } from '../src/core/output.js';
import { checkProjectRelativePath, displayPath, resolveInProject, toPosixPath } from '../src/core/paths.js';
import { runProcess } from '../src/core/process.js';

describe('paths', () => {
  it('accepts relative paths and rejects absolute or escaping ones', () => {
    assert.equal(checkProjectRelativePath('README.md'), undefined);
    assert.equal(checkProjectRelativePath('src/../README.md'), undefined);
    assert.equal(checkProjectRelativePath('docs\\guide.md'), undefined);
    assert.match(checkProjectRelativePath('') ?? '', /empty/);
    assert.match(checkProjectRelativePath('/etc/hosts') ?? '', /absolute/);
    assert.match(checkProjectRelativePath('\\\\server\\share') ?? '', /absolute/);
    assert.match(checkProjectRelativePath('D:relative') ?? '', /absolute/);
    assert.match(checkProjectRelativePath('..') ?? '', /inside/);
    assert.match(checkProjectRelativePath('..\\outside') ?? '', /inside/);
    assert.match(checkProjectRelativePath('a/../../b') ?? '', /inside/);
  });

  it('normalizes separators', () => {
    assert.equal(toPosixPath('a\\b\\c.txt'), 'a/b/c.txt');
    assert.equal(toPosixPath('./a//b/'), 'a/b');
    assert.equal(toPosixPath('.'), '.');
  });

  it('resolves project paths with the platform separator', () => {
    const root = path.resolve('project-root');
    const resolved = resolveInProject(root, 'src\\nested/file.ts');
    assert.equal(resolved, path.join(root, 'src', 'nested', 'file.ts'));
    assert.equal(displayPath(root, resolved), 'src/nested/file.ts');
    assert.equal(displayPath(root, root), '.');
  });
});

describe('output sanitizing', () => {
  it('strips ANSI escape sequences', () => {
    assert.equal(stripAnsi('\u001b[31mred\u001b[39m plain \u001b]8;;http://x\u0007link\u001b]8;;\u0007'), 'red plain link');
  });

  it('redacts well-known token formats and literal secrets', () => {
    const text = [
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'key sk-proj-abcdefghijklmnopqrstuvwx',
      'aws AKIAABCDEFGHIJKLMNOP',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
      'custom my-literal-secret-value',
      'short abc',
    ].join('\n');
    const result = redact(text, ['my-literal-secret-value', 'abc']);
    assert.ok(!result.includes('ghp_abc'));
    assert.ok(!result.includes('sk-proj'));
    assert.ok(!result.includes('AKIAABCDEFGHIJKLMNOP'));
    assert.ok(result.includes(`Bearer ${REDACTED}`));
    assert.ok(!result.includes('my-literal-secret-value'));
    assert.ok(result.includes('short abc'), 'literals shorter than 8 characters are not redacted');
  });

  it('normalizes CRLF output', () => {
    assert.equal(sanitizeOutput('a\r\nb\rc'), 'a\nb\nc');
  });

  it('keeps the last non-empty lines within limits', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n') + '\n\n';
    const tail = tailLines(text, 5);
    assert.deepEqual(tail, ['line 46', 'line 47', 'line 48', 'line 49', 'line 50']);
    assert.ok(tailLines('x'.repeat(5000), 5, 100)[0]?.endsWith('...'));
  });

  it('formats durations and caps lists', () => {
    assert.equal(formatDuration(250), '250ms');
    assert.equal(formatDuration(4200), '4.2s');
    assert.equal(formatDuration(125_000), '2m 5s');
    assert.deepEqual(capList(['a', 'b', 'c'], 2), ['a', 'b', '... and 1 more']);
  });
});

describe('process runner', () => {
  it('captures exit code and output of a real process', async () => {
    const result = await runProcess(process.execPath, ['-e', 'console.log("out"); console.error("err"); process.exit(4)'], {
      cwd: process.cwd(),
      timeoutMs: 20_000,
    });
    assert.equal(result.exitCode, 4);
    assert.equal(result.stdout.trim(), 'out');
    assert.equal(result.stderr.trim(), 'err');
    assert.equal(result.timedOut, false);
  });

  it('reports spawn failures instead of throwing', async () => {
    const result = await runProcess('proofdone-definitely-missing-binary', [], { cwd: process.cwd(), timeoutMs: 5000 });
    assert.equal(result.spawnError?.code, 'ENOENT');
    assert.equal(result.exitCode, null);
  });

  it('kills processes that exceed the timeout', async () => {
    const started = Date.now();
    const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      cwd: process.cwd(),
      timeoutMs: 300,
    });
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 15_000, 'should not wait for the full sleep');
  });

  it('keeps only the tail of very large output', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(200000) + "END")'], {
      cwd: process.cwd(),
      timeoutMs: 20_000,
      maxOutputBytes: 1000,
    });
    assert.equal(result.outputTruncated, true);
    assert.ok(result.stdout.endsWith('END'));
    assert.ok(result.stdout.length <= 1000);
  });
});
