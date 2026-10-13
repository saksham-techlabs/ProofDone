export const CHECK_STATUSES = ['PASS', 'FAIL', 'WARNING', 'NOT_CHECKED', 'ERROR'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const VERDICTS = ['DONE', 'NOT_DONE', 'UNVERIFIED'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Fields shared by every check after validation. */
export interface BaseCheckConfig {
  id: string;
  name: string;
  required: boolean;
  timeoutMs?: number;
}

export interface CommandCheckConfig extends BaseCheckConfig {
  type: 'command';
  command: string;
  cwd?: string;
  env: Record<string, string>;
  expectExitCode: number;
}

export interface GitRepoCheckConfig extends BaseCheckConfig {
  type: 'git-repo';
}

export interface GitCleanCheckConfig extends BaseCheckConfig {
  type: 'git-clean';
  allowUntracked: boolean;
}

export interface GitBranchCheckConfig extends BaseCheckConfig {
  type: 'git-branch';
  expected: string;
}

export interface GitUpstreamCheckConfig extends BaseCheckConfig {
  type: 'git-upstream';
  allowAhead: boolean;
  allowBehind: boolean;
}

export interface FilesCheckConfig extends BaseCheckConfig {
  type: 'files';
  mustExist: string[];
  mustNotExist: string[];
}

export interface FileContentCheckConfig extends BaseCheckConfig {
  type: 'file-content';
  path: string;
  contains: string[];
  notContains: string[];
  ignoreCase: boolean;
}

export type HttpMethod = 'GET' | 'HEAD';

export interface HttpCheckConfig extends BaseCheckConfig {
  type: 'http';
  url: string;
  method: HttpMethod;
  /** Accepted status codes. When undefined, any 2xx status is accepted. */
  expectStatus?: number[];
  bodyContains?: string;
}

export type DockerExpectation = 'exists' | 'running' | 'healthy';

export interface DockerCheckConfig extends BaseCheckConfig {
  type: 'docker';
  container: string;
  expect: DockerExpectation;
}

export type CheckConfig =
  | CommandCheckConfig
  | GitRepoCheckConfig
  | GitCleanCheckConfig
  | GitBranchCheckConfig
  | GitUpstreamCheckConfig
  | FilesCheckConfig
  | FileContentCheckConfig
  | HttpCheckConfig
  | DockerCheckConfig;

export type CheckType = CheckConfig['type'];

export interface ProofDoneConfig {
  version: 1;
  checks: CheckConfig[];
}

export interface CheckResult {
  id: string;
  name: string;
  type: CheckType;
  required: boolean;
  status: CheckStatus;
  /** One-line, human-readable explanation of the status. */
  summary: string;
  /** Additional human-readable evidence lines (file lists, output tails, ...). */
  details: string[];
  /** Structured evidence for machine consumers. */
  evidence: Record<string, unknown>;
  durationMs: number;
}

export interface StatusCounts {
  total: number;
  pass: number;
  fail: number;
  warning: number;
  notChecked: number;
  error: number;
}

export interface VerificationReport {
  tool: 'proofdone';
  version: string;
  reportVersion: 1;
  projectRoot: string;
  configPath: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  strict: boolean;
  /** Present when the run was restricted with --only. */
  only?: string[];
  verdict: Verdict;
  reason: string;
  summary: StatusCounts;
  checks: CheckResult[];
}
