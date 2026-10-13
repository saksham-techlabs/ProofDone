import type { CheckConfig, CheckType } from '../types/index.js';
import { commandCheck } from './command/command-check.js';
import type { CheckDefinition } from './definition.js';
import { dockerCheck } from './docker/docker-check.js';
import { fileContentCheck } from './files/file-content-check.js';
import { filesCheck } from './files/files-check.js';
import { gitBranchCheck, gitCleanCheck, gitRepoCheck, gitUpstreamCheck } from './git/git-checks.js';
import { httpCheck } from './http/http-check.js';

type DefinitionMap = { [K in CheckType]: CheckDefinition<Extract<CheckConfig, { type: K }>> };

const definitions: DefinitionMap = {
  command: commandCheck,
  'git-repo': gitRepoCheck,
  'git-clean': gitCleanCheck,
  'git-branch': gitBranchCheck,
  'git-upstream': gitUpstreamCheck,
  files: filesCheck,
  'file-content': fileContentCheck,
  http: httpCheck,
  docker: dockerCheck,
};

export const CHECK_TYPES = Object.keys(definitions) as CheckType[];

export function isCheckType(value: unknown): value is CheckType {
  return typeof value === 'string' && Object.hasOwn(definitions, value);
}

export function getDefinition<T extends CheckType>(type: T): DefinitionMap[T] {
  return definitions[type];
}

/** Returns the definition for a validated config, typed to match it. */
export function definitionFor<C extends CheckConfig>(config: C): CheckDefinition<C> {
  return definitions[config.type] as unknown as CheckDefinition<C>;
}
