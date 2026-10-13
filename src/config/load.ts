import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ProofDoneError, errorMessage } from '../core/errors.js';
import type { ProofDoneConfig } from '../types/index.js';
import { validateConfig } from './validate.js';

export const DEFAULT_CONFIG_FILE = 'proofdone.config.json';

export interface LoadedConfig {
  config: ProofDoneConfig;
  /** Absolute path of the config file. */
  configPath: string;
  /** Directory containing the config; all relative paths in the config resolve against it. */
  projectRoot: string;
}

export function resolveConfigPath(cwd: string, configOption?: string): string {
  return path.resolve(cwd, configOption ?? DEFAULT_CONFIG_FILE);
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProofDoneError(
        'CONFIG_NOT_FOUND',
        `No config found at ${configPath}. Run \`proofdone init\` to create one, or pass --config <file>.`,
      );
    }
    throw new ProofDoneError('IO', `Could not read config ${configPath}: ${errorMessage(error)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new ProofDoneError('CONFIG_PARSE', `Config ${configPath} is not valid JSON: ${errorMessage(error)}`);
  }

  const { config, issues } = validateConfig(raw);
  if (!config) {
    throw new ProofDoneError('CONFIG_INVALID', `Config ${configPath} is invalid (${issues.length} issue(s)).`, issues);
  }
  return { config, configPath, projectRoot: path.dirname(configPath) };
}
