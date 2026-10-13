import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveConfigPath } from '../../config/load.js';
import { buildStarterConfig } from '../../config/starter.js';
import { ProofDoneError, errorMessage } from '../../core/errors.js';
import type { CliIO } from '../io.js';

export interface InitOptions {
  cwd: string;
  config?: string;
  force: boolean;
}

export async function runInit(options: InitOptions, io: CliIO): Promise<number> {
  const root = path.resolve(io.cwd, options.cwd);
  try {
    if (!(await stat(root)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ProofDoneError('USAGE', `Project directory does not exist: ${root}`);
  }
  const configPath = resolveConfigPath(root, options.config);
  const { config, notes } = await buildStarterConfig(path.dirname(configPath));
  const text = `${JSON.stringify(config, null, 2)}\n`;

  try {
    await mkdir(path.dirname(configPath), { recursive: true });
    // 'wx' fails atomically if the file already exists.
    await writeFile(configPath, text, { encoding: 'utf8', flag: options.force ? 'w' : 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ProofDoneError(
        'CONFIG_EXISTS',
        `${configPath} already exists. Nothing was changed. Use --force to overwrite it.`,
      );
    }
    throw new ProofDoneError('IO', `Could not write ${configPath}: ${errorMessage(error)}`);
  }

  io.stdout.write(`Created ${configPath} with ${config.checks.length} check(s).\n`);
  for (const note of notes) io.stdout.write(`  - ${note}\n`);
  io.stdout.write('\nReview the config, then run: proofdone verify\n');
  return 0;
}
