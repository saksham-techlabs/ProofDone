import path from 'node:path';
import { loadConfig, resolveConfigPath } from '../../config/load.js';
import { ProofDoneError } from '../../core/errors.js';
import { runVerification } from '../../core/runner.js';
import { exitCodeFor } from '../../core/verdict.js';
import { createColors } from '../../reporters/color.js';
import { renderJsonReport } from '../../reporters/json.js';
import { renderTextReport, statusLabel } from '../../reporters/text.js';
import type { CliIO } from '../io.js';

export interface VerifyOptions {
  cwd: string;
  config?: string;
  json: boolean;
  only?: string;
  strict: boolean;
  quiet: boolean;
  noColor: boolean;
}

function parseOnly(value: string | undefined, knownIds: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) throw new ProofDoneError('USAGE', '--only requires at least one check id');
  const unknown = ids.filter((id) => !knownIds.includes(id));
  if (unknown.length > 0) {
    throw new ProofDoneError(
      'USAGE',
      `Unknown check id(s) for --only: ${unknown.join(', ')}. Known ids: ${knownIds.join(', ')}`,
    );
  }
  return ids;
}

export async function runVerify(options: VerifyOptions, io: CliIO): Promise<number> {
  const loaded = await loadConfig(resolveConfigPath(path.resolve(io.cwd, options.cwd), options.config));
  const only = parseOnly(
    options.only,
    loaded.config.checks.map((c) => c.id),
  );

  const showProgress = !options.json && !options.quiet;
  const report = await runVerification({
    config: loaded.config,
    projectRoot: loaded.projectRoot,
    configPath: loaded.configPath,
    strict: options.strict,
    ...(only ? { only } : {}),
    onCheckStart: showProgress
      ? (check, index, total) => io.stderr.write(`[${index + 1}/${total}] ${check.name} ...\n`)
      : undefined,
    onCheckComplete: showProgress
      ? (result, index, total) => io.stderr.write(`[${index + 1}/${total}] ${result.name}: ${statusLabel(result.status)}\n`)
      : undefined,
  });
  if (showProgress) io.stderr.write('\n');

  const exitCode = exitCodeFor(report.verdict);
  if (options.json) {
    io.stdout.write(renderJsonReport({ ...report, exitCode }));
  } else {
    const colors = createColors({ isTTY: io.stdout.isTTY === true, noColor: options.noColor, env: io.env });
    io.stdout.write(renderTextReport(report, colors));
  }
  return exitCode;
}
