import type { ConfigIssue, ProofDoneErrorCode } from '../core/errors.js';
import type { VerificationReport } from '../types/index.js';
import { VERSION } from '../version.js';
import { sanitizeValue } from '../core/output.js';

export function renderJsonReport(report: VerificationReport & { exitCode: number }): string {
  return `${JSON.stringify(sanitizeValue(report), null, 2)}\n`;
}

/** JSON shape for runs that could not produce a verification report (exit code 2). */
export function renderJsonError(code: ProofDoneErrorCode | 'INTERNAL', message: string, issues: ConfigIssue[] = []): string {
  const payload = {
    tool: 'proofdone',
    version: VERSION,
    reportVersion: 1,
    verdict: null,
    exitCode: 2,
    error: { code, message, issues },
  };
  return `${JSON.stringify(sanitizeValue(payload), null, 2)}\n`;
}
