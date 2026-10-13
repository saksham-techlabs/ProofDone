import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeVerdict, exitCodeFor } from '../src/core/verdict.js';
import type { CheckResult, CheckStatus } from '../src/types/index.js';

function result(id: string, status: CheckStatus, required = true): CheckResult {
  return {
    id,
    name: id,
    type: 'command',
    required,
    status,
    summary: `${id} summary`,
    details: [],
    evidence: {},
    durationMs: 1,
  };
}

describe('verdict model', () => {
  it('is DONE when every required check passes', () => {
    const v = computeVerdict([result('a', 'PASS'), result('b', 'PASS')]);
    assert.equal(v.verdict, 'DONE');
    assert.equal(v.reason, 'All 2 required checks passed.');
    assert.equal(exitCodeFor(v.verdict), 0);
  });

  it('is NOT_DONE when any required check fails or errors', () => {
    const fail = computeVerdict([result('a', 'PASS'), result('b', 'FAIL')]);
    assert.equal(fail.verdict, 'NOT_DONE');
    assert.match(fail.reason, /Required check failed: b \(b summary\)/);
    const error = computeVerdict([result('a', 'ERROR')]);
    assert.equal(error.verdict, 'NOT_DONE');
    assert.equal(exitCodeFor('NOT_DONE'), 1);
  });

  it('prefers NOT_DONE over UNVERIFIED', () => {
    const v = computeVerdict([result('a', 'NOT_CHECKED'), result('b', 'FAIL')]);
    assert.equal(v.verdict, 'NOT_DONE');
  });

  it('is UNVERIFIED when a required check could not be checked', () => {
    const v = computeVerdict([result('a', 'PASS'), result('docker', 'NOT_CHECKED')]);
    assert.equal(v.verdict, 'UNVERIFIED');
    assert.match(v.reason, /Could not verify 1 required check: docker/);
    assert.equal(exitCodeFor(v.verdict), 3);
  });

  it('ignores optional checks for the verdict but mentions them', () => {
    const v = computeVerdict([
      result('a', 'PASS'),
      result('docker', 'NOT_CHECKED', false),
      result('lint', 'FAIL', false),
      result('perf', 'ERROR', false),
    ]);
    assert.equal(v.verdict, 'DONE');
    assert.match(v.reason, /3 optional checks did not pass/);
  });

  it('treats required warnings as DONE unless strict', () => {
    const results = [result('a', 'PASS'), result('git', 'WARNING')];
    const normal = computeVerdict(results);
    assert.equal(normal.verdict, 'DONE');
    assert.match(normal.reason, /1 warning/);
    const strict = computeVerdict(results, { strict: true });
    assert.equal(strict.verdict, 'NOT_DONE');
    assert.match(strict.reason, /Strict mode/);
  });

  it('counts statuses', () => {
    const v = computeVerdict([
      result('a', 'PASS'),
      result('b', 'FAIL'),
      result('c', 'WARNING'),
      result('d', 'NOT_CHECKED'),
      result('e', 'ERROR'),
    ]);
    assert.deepEqual(v.summary, { total: 5, pass: 1, fail: 1, warning: 1, notChecked: 1, error: 1 });
  });

  it('summarizes many failures compactly', () => {
    const v = computeVerdict(['a', 'b', 'c', 'd', 'e'].map((id) => result(id, 'FAIL')));
    assert.match(v.reason, /^5 required checks failed: .*and 2 more\.$/);
  });
});
