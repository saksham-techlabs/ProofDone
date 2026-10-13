import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeVerdict, exitCodeFor } from '../src/core/verdict.js';
import { createColors } from '../src/reporters/color.js';
import { renderJsonError, renderJsonReport } from '../src/reporters/json.js';
import { renderTextReport } from '../src/reporters/text.js';
import type { CheckResult, VerificationReport } from '../src/types/index.js';

function makeReport(): VerificationReport {
  const checks: CheckResult[] = [
    {
      id: 'build',
      name: 'Build',
      type: 'command',
      required: true,
      status: 'PASS',
      summary: 'exit 0 in 4.2s',
      details: [],
      evidence: { exitCode: 0 },
      durationMs: 4200,
    },
    {
      id: 'git-clean',
      name: 'Git working tree',
      type: 'git-clean',
      required: true,
      status: 'FAIL',
      summary: 'working tree has uncommitted changes: 1 unstaged',
      details: ['unstaged: src/index.ts'],
      evidence: { counts: { unstaged: 1 } },
      durationMs: 40,
    },
    {
      id: 'docker',
      name: 'Docker health',
      type: 'docker',
      required: false,
      status: 'NOT_CHECKED',
      summary: 'Docker CLI not found on PATH',
      details: [],
      evidence: {},
      durationMs: 5,
    },
  ];
  const { verdict, reason, summary } = computeVerdict(checks);
  return {
    tool: 'proofdone',
    version: '0.1.0',
    reportVersion: 1,
    projectRoot: '/work/app',
    configPath: '/work/app/proofdone.config.json',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:04.245Z',
    durationMs: 4245,
    strict: false,
    verdict,
    reason,
    summary,
    checks,
  };
}

describe('text reporter', () => {
  it('renders statuses, evidence, and the final verdict', () => {
    const text = renderTextReport(makeReport());
    assert.match(text, /^ProofDone Verification\n/);
    assert.match(text, /Build\s+PASS\s+exit 0 in 4\.2s/);
    assert.match(text, /Git working tree\s+FAIL\s+working tree has uncommitted changes/);
    assert.match(text, /Docker health \(optional\)\s+NOT CHECKED\s+Docker CLI not found/);
    assert.match(text, /Evidence\n {2}FAIL {2}Git working tree\n {6}unstaged: src\/index\.ts/);
    assert.match(text, /1 passed, 1 failed, 0 warnings, 1 not checked, 0 errors \(3 checks in 4\.2s\)/);
    assert.match(text, /Final verdict: NOT DONE\nReason: Required check failed: Git working tree/);
    assert.ok(!text.includes('\u001b['), 'plain output must not contain ANSI codes');
    assert.ok(/^[\x20-\x7e\n]*$/.test(text), 'output is ASCII-only for legacy consoles');
  });

  it('keeps columns aligned for long names', () => {
    const report = makeReport();
    const first = report.checks[0];
    assert.ok(first);
    report.checks[0] = { ...first, name: 'A very long check name that goes on and on beyond the column' };
    const rows = renderTextReport(report)
      .split('\n')
      .filter((line) => /^ {2}\S.*\s(PASS|FAIL|NOT CHECKED)\s/.test(line));
    assert.equal(rows.length, 3);
    const statusColumns = rows.map((line) => line.search(/(PASS|FAIL|NOT CHECKED)/));
    assert.equal(new Set(statusColumns).size, 1, 'status column must line up');
    assert.ok(rows[0]?.includes('...'));
  });

  it('applies colors only when enabled', () => {
    const colored = renderTextReport(makeReport(), createColors({ isTTY: true, env: {} }));
    assert.ok(colored.includes('\u001b[31m'));
    const noColor = createColors({ isTTY: true, env: { NO_COLOR: '1' } });
    assert.ok(!renderTextReport(makeReport(), noColor).includes('\u001b['));
    const piped = createColors({ isTTY: false, env: {} });
    assert.ok(!renderTextReport(makeReport(), piped).includes('\u001b['));
    const forced = createColors({ isTTY: false, env: { FORCE_COLOR: '1' } });
    assert.ok(renderTextReport(makeReport(), forced).includes('\u001b['));
  });
});

describe('json reporter', () => {
  it('produces a parseable report with verdict, exit code, and evidence', () => {
    const report = makeReport();
    const parsed = JSON.parse(renderJsonReport({ ...report, exitCode: exitCodeFor(report.verdict) })) as Record<string, unknown>;
    assert.equal(parsed.tool, 'proofdone');
    assert.equal(parsed.reportVersion, 1);
    assert.equal(parsed.verdict, 'NOT_DONE');
    assert.equal(parsed.exitCode, 1);
    const checks = parsed.checks as CheckResult[];
    assert.equal(checks.length, 3);
    assert.deepEqual(checks[1]?.evidence, { counts: { unstaged: 1 } });
    assert.deepEqual(parsed.summary, { total: 3, pass: 1, fail: 1, warning: 0, notChecked: 1, error: 0 });
  });

  it('produces a structured error payload', () => {
    const parsed = JSON.parse(
      renderJsonError('CONFIG_INVALID', 'bad config', [{ path: 'checks[0].type', message: 'is required' }]),
    ) as { verdict: unknown; exitCode: number; error: { code: string; issues: unknown[] } };
    assert.equal(parsed.verdict, null);
    assert.equal(parsed.exitCode, 2);
    assert.equal(parsed.error.code, 'CONFIG_INVALID');
    assert.equal(parsed.error.issues.length, 1);
  });
});
