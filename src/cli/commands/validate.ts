import path from 'node:path';
import { definitionFor } from '../../checks/registry.js';
import { loadConfig, resolveConfigPath } from '../../config/load.js';
import { VERSION } from '../../version.js';
import type { CliIO } from '../io.js';

export interface ValidateOptions {
  cwd: string;
  config?: string;
  json: boolean;
}

export async function runValidate(options: ValidateOptions, io: CliIO): Promise<number> {
  const loaded = await loadConfig(resolveConfigPath(path.resolve(io.cwd, options.cwd), options.config));
  const checks = loaded.config.checks.map((check) => ({
    id: check.id,
    name: check.name,
    type: check.type,
    required: check.required,
    description: definitionFor(check).describe(check),
  }));
  const commands = loaded.config.checks.flatMap((check) =>
    check.type === 'command' ? [{ id: check.id, command: check.command, cwd: check.cwd ?? '.' }] : [],
  );

  if (options.json) {
    const payload = {
      tool: 'proofdone',
      version: VERSION,
      valid: true,
      configPath: loaded.configPath,
      projectRoot: loaded.projectRoot,
      checks,
      commands,
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  io.stdout.write(`Config is valid: ${loaded.configPath}\n\n`);
  for (const check of checks) {
    const flag = check.required ? 'required' : 'optional';
    io.stdout.write(`  ${check.id} [${check.type}, ${flag}]: ${check.description}\n`);
  }
  io.stdout.write('\n');
  if (commands.length > 0) {
    io.stdout.write('`proofdone verify` will execute these commands:\n');
    for (const entry of commands) io.stdout.write(`  (${entry.cwd}) ${entry.command}\n`);
  } else {
    io.stdout.write('`proofdone verify` will not execute any shell commands.\n');
  }
  return 0;
}
