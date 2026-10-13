import type { FieldReader } from '../config/reader.js';
import type { BaseCheckConfig, CheckConfig, CheckStatus } from '../types/index.js';

/** An external tool invocation prefix, e.g. `{ command: 'git', args: [] }`. */
export interface ToolCommand {
  command: string;
  args: readonly string[];
}

export interface ToolPaths {
  git: ToolCommand;
  docker: ToolCommand;
}

export const DEFAULT_TOOLS: ToolPaths = {
  git: { command: 'git', args: [] },
  docker: { command: 'docker', args: [] },
};

export interface CheckContext {
  /** Absolute path of the project root (the directory containing the config file). */
  projectRoot: string;
  tools: ToolPaths;
}

export interface CheckOutcome {
  status: CheckStatus;
  summary: string;
  details?: string[];
  evidence?: Record<string, unknown>;
}

/**
 * A verification capability. Adding a new check type means implementing this
 * interface and registering it in `registry.ts`.
 */
export interface CheckDefinition<C extends CheckConfig> {
  readonly type: C['type'];
  /** Short description used in help and `validate` output. */
  readonly description: string;
  /** Reads type-specific fields. Problems are recorded on the reader, not thrown. */
  parse(reader: FieldReader, base: BaseCheckConfig): C;
  /** One-line description of what will be verified (shown by `proofdone validate`). */
  describe(config: C): string;
  /** Performs the verification. Must not modify the project. */
  run(config: C, context: CheckContext): Promise<CheckOutcome>;
}
