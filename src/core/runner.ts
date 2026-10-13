import { DEFAULT_TOOLS, type CheckOutcome, type ToolPaths } from '../checks/definition.js';
import { definitionFor } from '../checks/registry.js';
import type { CheckConfig, CheckResult, ProofDoneConfig, VerificationReport } from '../types/index.js';
import { VERSION } from '../version.js';
import { errorMessage } from './errors.js';
import { computeVerdict } from './verdict.js';
import { sanitizeValue } from './output.js';

export interface RunVerificationOptions {
  config: ProofDoneConfig;
  projectRoot: string;
  configPath: string;
  strict?: boolean;
  /** Restrict the run to these check ids (already validated to exist). */
  only?: string[];
  /** Override external tool locations (used by tests). */
  tools?: Partial<ToolPaths>;
  onCheckStart?: (check: CheckConfig, index: number, total: number) => void;
  onCheckComplete?: (result: CheckResult, index: number, total: number) => void;
}

/** Runs checks sequentially (deterministic; commands may compete for resources) and builds the report. */
export async function runVerification(options: RunVerificationOptions): Promise<VerificationReport> {
  const startedAt = new Date();
  const started = performance.now();
  const tools: ToolPaths = { ...DEFAULT_TOOLS, ...options.tools };
  const context = { projectRoot: options.projectRoot, tools };
  const only = options.only;
  const checks = only ? options.config.checks.filter((c) => only.includes(c.id)) : options.config.checks;

  const results: CheckResult[] = [];
  for (const [index, check] of checks.entries()) {
    options.onCheckStart?.(check, index, checks.length);
    const checkStarted = performance.now();
    let outcome: CheckOutcome;
    try {
      outcome = await definitionFor(check).run(check, context);
    } catch (error) {
      outcome = { status: 'ERROR', summary: `check crashed: ${errorMessage(error)}` };
    }
    const result: CheckResult = sanitizeValue({
      id: check.id,
      name: check.name,
      type: check.type,
      required: check.required,
      status: outcome.status,
      summary: outcome.summary,
      details: outcome.details ?? [],
      evidence: outcome.evidence ?? {},
      durationMs: Math.round(performance.now() - checkStarted),
    }, check.type === 'command' ? Object.values(check.env) : []);
    results.push(result);
    options.onCheckComplete?.(result, index, checks.length);
  }

  const { verdict, reason, summary } = computeVerdict(results, { strict: options.strict ?? false });
  const report: VerificationReport = {
    tool: 'proofdone',
    version: VERSION,
    reportVersion: 1,
    projectRoot: options.projectRoot,
    configPath: options.configPath,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    strict: options.strict ?? false,
    verdict,
    reason,
    summary,
    checks: results,
  };
  if (only) report.only = only;
  return sanitizeValue(report);
}
