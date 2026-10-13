import { capList } from '../../core/output.js';
import type {
  GitBranchCheckConfig,
  GitCleanCheckConfig,
  GitRepoCheckConfig,
  GitUpstreamCheckConfig,
} from '../../types/index.js';
import type { CheckDefinition } from '../definition.js';
import {
  DEFAULT_GIT_TIMEOUT_MS,
  classifyGitFailure,
  describeBranch,
  probeFailureOutcome,
  probeGit,
  runGit,
  type GitStatus,
} from './git-status.js';

const MAX_LISTED_FILES = 20;

function statusEvidence(status: GitStatus): Record<string, unknown> {
  return {
    branch: status.branch,
    head: status.head,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    staged: status.staged.slice(0, 100),
    unstaged: status.unstaged.slice(0, 100),
    untracked: status.untracked.slice(0, 100),
    conflicted: status.conflicted.slice(0, 100),
    counts: {
      staged: status.staged.length,
      unstaged: status.unstaged.length,
      untracked: status.untracked.length,
      conflicted: status.conflicted.length,
    },
  };
}

export const gitRepoCheck: CheckDefinition<GitRepoCheckConfig> = {
  type: 'git-repo',
  description: 'Requires the project to be inside a git repository; reports branch and HEAD.',

  parse(_reader, base) {
    return { ...base, type: 'git-repo' };
  },

  describe() {
    return 'project is inside a git repository';
  },

  async run(config, context) {
    const timeoutMs = config.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
    const probe = await probeGit(context, timeoutMs);
    if (probe.kind !== 'ok') return probeFailureOutcome(probe);

    const topLevel = await runGit(context, ['rev-parse', '--show-toplevel'], timeoutMs);
    const failure = classifyGitFailure(topLevel);
    if (failure) return probeFailureOutcome(failure);

    const root = topLevel.stdout.trim();
    const head = probe.status.head ? probe.status.head.slice(0, 7) : 'no commits yet';
    return {
      status: 'PASS',
      summary: `git repository on ${describeBranch(probe.status)} (${head})`,
      details: [`Repository root: ${root}`],
      evidence: { repositoryRoot: root, ...statusEvidence(probe.status) },
    };
  },
};

export const gitCleanCheck: CheckDefinition<GitCleanCheckConfig> = {
  type: 'git-clean',
  description: 'Requires no staged, unstaged, conflicted or (by default) untracked changes.',

  parse(reader, base) {
    return { ...base, type: 'git-clean', allowUntracked: reader.boolean('allowUntracked', false) };
  },

  describe(config) {
    return config.allowUntracked
      ? 'git working tree has no staged/unstaged changes (untracked files allowed)'
      : 'git working tree is clean (no staged, unstaged or untracked changes)';
  },

  async run(config, context) {
    const probe = await probeGit(context, config.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
    if (probe.kind !== 'ok') return probeFailureOutcome(probe);
    const s = probe.status;
    const evidence = statusEvidence(s);

    const details: string[] = [];
    const list = (label: string, files: string[]): void => {
      for (const line of capList(files, MAX_LISTED_FILES)) details.push(`${label}: ${line}`);
    };
    list('conflicted', s.conflicted);
    list('staged', s.staged);
    list('unstaged', s.unstaged);
    list('untracked', s.untracked);

    const blocking = s.conflicted.length + s.staged.length + s.unstaged.length;
    const branch = describeBranch(s);

    if (blocking === 0 && s.untracked.length === 0) {
      return { status: 'PASS', summary: `working tree clean on ${branch}`, evidence };
    }

    const parts: string[] = [];
    if (s.conflicted.length) parts.push(`${s.conflicted.length} conflicted`);
    if (s.staged.length) parts.push(`${s.staged.length} staged`);
    if (s.unstaged.length) parts.push(`${s.unstaged.length} unstaged`);
    if (s.untracked.length) parts.push(`${s.untracked.length} untracked`);

    if (blocking === 0 && config.allowUntracked) {
      return {
        status: 'WARNING',
        summary: `no uncommitted changes, but ${s.untracked.length} untracked file(s) on ${branch}`,
        details,
        evidence,
      };
    }
    return {
      status: 'FAIL',
      summary: `working tree has uncommitted changes: ${parts.join(', ')}`,
      details,
      evidence,
    };
  },
};

export const gitBranchCheck: CheckDefinition<GitBranchCheckConfig> = {
  type: 'git-branch',
  description: 'Requires the current branch to match the expected name.',

  parse(reader, base) {
    return { ...base, type: 'git-branch', expected: reader.requiredString('expected') };
  },

  describe(config) {
    return `current git branch is \`${config.expected}\``;
  },

  async run(config, context) {
    const probe = await probeGit(context, config.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
    if (probe.kind !== 'ok') return probeFailureOutcome(probe);
    const actual = probe.status.branch;
    const evidence = { expected: config.expected, actual, head: probe.status.head };
    if (actual === config.expected) {
      return { status: 'PASS', summary: `on branch ${actual}`, evidence };
    }
    return {
      status: 'FAIL',
      summary: `on ${describeBranch(probe.status)}, expected ${config.expected}`,
      evidence,
    };
  },
};

export const gitUpstreamCheck: CheckDefinition<GitUpstreamCheckConfig> = {
  type: 'git-upstream',
  description: 'Compares the branch with its upstream tracking ref (no fetch is performed).',

  parse(reader, base) {
    return {
      ...base,
      type: 'git-upstream',
      allowAhead: reader.boolean('allowAhead', false),
      allowBehind: reader.boolean('allowBehind', false),
    };
  },

  describe(config) {
    const rules = [
      config.allowAhead ? 'unpushed commits allowed' : 'no unpushed commits',
      config.allowBehind ? 'behind allowed' : 'not behind',
    ];
    return `branch matches its upstream (${rules.join(', ')}; uses last fetched state)`;
  },

  async run(config, context) {
    const probe = await probeGit(context, config.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
    if (probe.kind !== 'ok') return probeFailureOutcome(probe);
    const s = probe.status;
    const note = 'Compared against the local remote-tracking ref; ProofDone does not run `git fetch`.';
    const evidence = { branch: s.branch, upstream: s.upstream, ahead: s.ahead, behind: s.behind };

    if (s.branch === null) {
      return { status: 'NOT_CHECKED', summary: 'HEAD is detached; there is no upstream to compare', evidence };
    }
    if (s.upstream === null) {
      return { status: 'NOT_CHECKED', summary: `branch ${s.branch} has no upstream configured`, evidence };
    }
    if (s.ahead === null || s.behind === null) {
      return {
        status: 'NOT_CHECKED',
        summary: `upstream ${s.upstream} is not available locally (deleted or never fetched)`,
        evidence,
      };
    }

    const problems: string[] = [];
    if (s.ahead > 0 && !config.allowAhead) problems.push(`${s.ahead} commit(s) not pushed`);
    if (s.behind > 0 && !config.allowBehind) problems.push(`${s.behind} commit(s) behind`);
    const position = `${s.branch} vs ${s.upstream}: ahead ${s.ahead}, behind ${s.behind}`;

    if (problems.length > 0) {
      return { status: 'FAIL', summary: `${problems.join(', ')} (${s.upstream})`, details: [position, note], evidence };
    }
    return { status: 'PASS', summary: `in sync with ${s.upstream}`, details: [position, note], evidence };
  },
};
