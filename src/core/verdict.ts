import type { CheckResult, StatusCounts, Verdict } from '../types/index.js';

export const EXIT_CODES = {
  DONE: 0,
  NOT_DONE: 1,
  /** Usage, configuration or internal error: verification did not run (completely). */
  ERROR: 2,
  UNVERIFIED: 3,
} as const;

export interface VerdictResult {
  verdict: Verdict;
  reason: string;
  summary: StatusCounts;
}

export function countStatuses(results: readonly CheckResult[]): StatusCounts {
  const counts: StatusCounts = { total: results.length, pass: 0, fail: 0, warning: 0, notChecked: 0, error: 0 };
  for (const result of results) {
    if (result.status === 'PASS') counts.pass++;
    else if (result.status === 'FAIL') counts.fail++;
    else if (result.status === 'WARNING') counts.warning++;
    else if (result.status === 'NOT_CHECKED') counts.notChecked++;
    else counts.error++;
  }
  return counts;
}

function describe(results: readonly CheckResult[], limit = 3): string {
  const shown = results.slice(0, limit).map((r) => `${r.name} (${r.summary})`);
  const more = results.length > limit ? `, and ${results.length - limit} more` : '';
  return `${shown.join('; ')}${more}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Verdict rules, applied in order (only `required` checks influence the verdict):
 *  1. any required FAIL or ERROR             -> NOT_DONE
 *  2. any required NOT_CHECKED               -> UNVERIFIED
 *  3. strict mode and any required WARNING   -> NOT_DONE
 *  4. otherwise                              -> DONE
 */
export function computeVerdict(results: readonly CheckResult[], options: { strict?: boolean } = {}): VerdictResult {
  const summary = countStatuses(results);
  const required = results.filter((r) => r.required);

  const failed = required.filter((r) => r.status === 'FAIL' || r.status === 'ERROR');
  if (failed.length > 0) {
    const label = failed.length === 1 ? 'Required check failed' : `${failed.length} required checks failed`;
    return { verdict: 'NOT_DONE', reason: `${label}: ${describe(failed)}.`, summary };
  }

  const unverified = required.filter((r) => r.status === 'NOT_CHECKED');
  if (unverified.length > 0) {
    return {
      verdict: 'UNVERIFIED',
      reason: `Could not verify ${plural(unverified.length, 'required check')}: ${describe(unverified)}.`,
      summary,
    };
  }

  const warned = required.filter((r) => r.status === 'WARNING');
  if (options.strict && warned.length > 0) {
    return {
      verdict: 'NOT_DONE',
      reason: `Strict mode: ${plural(warned.length, 'required check')} reported warnings: ${describe(warned)}.`,
      summary,
    };
  }

  const notes: string[] = [];
  if (warned.length > 0) notes.push(plural(warned.length, 'warning'));
  const optionalProblems = results.filter((r) => !r.required && r.status !== 'PASS');
  if (optionalProblems.length > 0) notes.push(`${plural(optionalProblems.length, 'optional check')} did not pass`);
  const suffix = notes.length > 0 ? ` (${notes.join('; ')})` : '';
  return {
    verdict: 'DONE',
    reason: required.length === 0
      ? `No required checks were selected${suffix}; this verdict establishes no required claims.`
      : warned.length > 0
        ? `No required checks failed${suffix}.`
        : `All ${plural(required.length, 'required check')} passed${suffix}.`,
    summary,
  };
}

export function exitCodeFor(verdict: Verdict): number {
  return EXIT_CODES[verdict];
}
