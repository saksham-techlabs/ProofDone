import { CHECK_TYPES, getDefinition, isCheckType } from '../checks/registry.js';
import type { ConfigIssue } from '../core/errors.js';
import type { BaseCheckConfig, CheckConfig, CheckType, ProofDoneConfig } from '../types/index.js';
import { FieldReader, isPlainObject } from './reader.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface ValidationResult {
  config?: ProofDoneConfig;
  issues: ConfigIssue[];
}

function parseCheck(raw: unknown, index: number, issues: ConfigIssue[], ids: Set<string>): CheckConfig | undefined {
  const at = `checks[${index}]`;
  if (!isPlainObject(raw)) {
    issues.push({ path: at, message: 'must be an object' });
    return undefined;
  }
  const reader = new FieldReader(raw, at, issues);

  const type = raw.type;
  reader.allow('type');
  if (type === undefined) {
    reader.issue('type', `is required (one of: ${CHECK_TYPES.join(', ')})`);
    return undefined;
  }
  if (!isCheckType(type)) {
    reader.issue('type', `unknown check type ${JSON.stringify(type)} (expected one of: ${CHECK_TYPES.join(', ')})`);
    return undefined;
  }

  const id = reader.requiredString('id');
  if (id && !ID_PATTERN.test(id)) {
    reader.issue('id', 'must be 1-64 characters: letters, digits, ".", "_" or "-", starting with a letter or digit');
  } else if (id && ids.has(id)) {
    reader.issue('id', `duplicate check id ${JSON.stringify(id)}`);
  }
  ids.add(id);

  const base: BaseCheckConfig = {
    id,
    name: reader.optionalString('name') ?? id,
    required: reader.boolean('required', true),
  };
  const timeoutMs = reader.optionalInteger('timeoutMs', 1, MAX_TIMEOUT_MS);
  if (timeoutMs !== undefined) base.timeoutMs = timeoutMs;

  const check = parseTyped(type, reader, base);
  reader.rejectUnknownKeys();
  return check;
}

function parseTyped(type: CheckType, reader: FieldReader, base: BaseCheckConfig): CheckConfig {
  // Each definition's parse is typed to its own config; the union return is safe here.
  return (getDefinition(type).parse as (r: FieldReader, b: BaseCheckConfig) => CheckConfig)(reader, base);
}

/** Validates untrusted JSON. Returns a config only when there are no issues. */
export function validateConfig(raw: unknown): ValidationResult {
  const issues: ConfigIssue[] = [];
  if (!isPlainObject(raw)) {
    return { issues: [{ path: '(root)', message: 'config must be a JSON object' }] };
  }
  const reader = new FieldReader(raw, '(root)', issues);
  reader.allow('$schema');

  if (raw.version !== undefined && raw.version !== 1) {
    reader.issue('version', 'unsupported config version (only 1 is supported)');
  }
  reader.allow('version');

  const checks: CheckConfig[] = [];
  reader.allow('checks');
  if (!Array.isArray(raw.checks)) {
    reader.issue('checks', 'is required and must be an array of checks');
  } else if (raw.checks.length === 0) {
    reader.issue('checks', 'must contain at least one check');
  } else {
    const ids = new Set<string>();
    raw.checks.forEach((entry, index) => {
      const check = parseCheck(entry, index, issues, ids);
      if (check) checks.push(check);
    });
  }
  reader.rejectUnknownKeys();

  if (issues.length > 0) return { issues };
  return { config: { version: 1, checks }, issues };
}
