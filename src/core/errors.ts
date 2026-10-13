export interface ConfigIssue {
  /** JSON-path-like location, e.g. `checks[2].command`. */
  path: string;
  message: string;
}

export type ProofDoneErrorCode =
  | 'USAGE'
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_PARSE'
  | 'CONFIG_INVALID'
  | 'CONFIG_EXISTS'
  | 'IO';

/** An expected, user-facing error. Always maps to exit code 2. */
export class ProofDoneError extends Error {
  readonly code: ProofDoneErrorCode;
  readonly issues: ConfigIssue[];

  constructor(code: ProofDoneErrorCode, message: string, issues: ConfigIssue[] = []) {
    super(message);
    this.name = 'ProofDoneError';
    this.code = code;
    this.issues = issues;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
