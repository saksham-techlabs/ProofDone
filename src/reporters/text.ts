import path from 'node:path';
import { formatDuration, sanitizeValue, truncate } from '../core/output.js';
import type { CheckResult, CheckStatus, Verdict, VerificationReport } from '../types/index.js';
import { plainColors, type Colors } from './color.js';

const STATUS_LABELS: Record<CheckStatus, string> = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  WARNING: 'WARNING',
  NOT_CHECKED: 'NOT CHECKED',
  ERROR: 'ERROR',
};

const VERDICT_LABELS: Record<Verdict, string> = {
  DONE: 'DONE',
  NOT_DONE: 'NOT DONE',
  UNVERIFIED: 'UNVERIFIED',
};

const STATUS_WIDTH = Math.max(...Object.values(STATUS_LABELS).map((label) => label.length));
const MAX_NAME_WIDTH = 40;

export function statusLabel(status: CheckStatus): string {
  return STATUS_LABELS[status];
}

function colorStatus(status: CheckStatus, text: string, c: Colors): string {
  if (status === 'PASS') return c.green(text);
  if (status === 'FAIL' || status === 'ERROR') return c.red(text);
  if (status === 'WARNING') return c.yellow(text);
  return c.gray(text);
}

function displayName(result: CheckResult): string {
  return result.required ? result.name : `${result.name} (optional)`;
}

/** Renders the human-readable report. Output is ASCII-only for legacy Windows consoles. */
export function renderTextReport(report: VerificationReport, c: Colors = plainColors): string {
  report = sanitizeValue(report);
  const lines: string[] = [];
  const nameWidth = Math.min(MAX_NAME_WIDTH, Math.max(0, ...report.checks.map((r) => displayName(r).length)));

  lines.push(c.bold('ProofDone Verification'));
  lines.push(c.gray(`Project: ${report.projectRoot}`));
  lines.push(c.gray(`Config:  ${path.basename(report.configPath)}${report.only ? `  (only: ${report.only.join(', ')})` : ''}`));
  lines.push('');

  for (const result of report.checks) {
    const name = truncate(displayName(result), nameWidth).padEnd(nameWidth);
    const status = colorStatus(result.status, statusLabel(result.status).padEnd(STATUS_WIDTH), c);
    lines.push(`  ${name}  ${status}  ${c.gray(result.summary)}`);
  }

  const withDetails = report.checks.filter((r) => r.status !== 'PASS' && r.details.length > 0);
  if (withDetails.length > 0) {
    lines.push('');
    lines.push(c.bold('Evidence'));
    for (const result of withDetails) {
      lines.push(`  ${colorStatus(result.status, statusLabel(result.status), c)}  ${displayName(result)}`);
      for (const detail of result.details) lines.push(`      ${detail}`);
    }
  }

  const s = report.summary;
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
  lines.push('');
  lines.push(
    c.gray(
      `${s.pass} passed, ${s.fail} failed, ${plural(s.warning, 'warning')}, ${s.notChecked} not checked, ` +
        `${plural(s.error, 'error')} (${plural(s.total, 'check')} in ${formatDuration(report.durationMs)})`,
    ),
  );
  lines.push('');
  const verdictText = VERDICT_LABELS[report.verdict];
  const colored =
    report.verdict === 'DONE' ? c.green(verdictText) : report.verdict === 'NOT_DONE' ? c.red(verdictText) : c.yellow(verdictText);
  lines.push(`${c.bold('Final verdict:')} ${c.bold(colored)}`);
  lines.push(`Reason: ${report.reason}`);
  return `${lines.join('\n')}\n`;
}
