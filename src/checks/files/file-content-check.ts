import { readFile, stat } from 'node:fs/promises';
import { capList } from '../../core/output.js';
import { resolveInProject } from '../../core/paths.js';
import type { FileContentCheckConfig } from '../../types/index.js';
import type { CheckDefinition, CheckOutcome } from '../definition.js';
import { locate } from './locate.js';

export const MAX_CONTENT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LINES_REPORTED = 10;

/** 1-based line numbers on which `needle` occurs. Matched text itself is never reported. */
function matchingLines(lines: readonly string[], needle: string): number[] {
  const result: number[] = [];
  lines.forEach((line, index) => {
    if (line.includes(needle)) result.push(index + 1);
  });
  return result;
}

export const fileContentCheck: CheckDefinition<FileContentCheckConfig> = {
  type: 'file-content',
  description: 'Requires a file to contain (contains) or not contain (notContains) literal text.',

  parse(reader, base) {
    const config: FileContentCheckConfig = {
      ...base,
      type: 'file-content',
      path: reader.requiredPath('path'),
      contains: reader.stringArray('contains'),
      notContains: reader.stringArray('notContains'),
      ignoreCase: reader.boolean('ignoreCase', false),
    };
    if (!reader.has('contains') && !reader.has('notContains')) {
      reader.issue('contains', 'a file-content check needs at least one of "contains" or "notContains"');
    }
    return config;
  },

  describe(config) {
    const parts: string[] = [];
    if (config.contains.length) parts.push(`contains ${config.contains.length} required text(s)`);
    if (config.notContains.length) parts.push(`contains none of ${config.notContains.length} forbidden text(s)`);
    return `${config.path} ${parts.join(' and ')}${config.ignoreCase ? ' (case-insensitive)' : ''}`;
  },

  async run(config, context): Promise<CheckOutcome> {
    const evidence: Record<string, unknown> = { path: config.path };
    const found = await locate(context.projectRoot, config.path);
    if (found.state === 'missing' || found.state === 'case-mismatch') {
      const hint = found.state === 'case-mismatch' ? ` (found ${found.actual} with different case)` : '';
      return { status: 'FAIL', summary: `file not found: ${config.path}${hint}`, evidence };
    }
    if (found.state === 'unreadable') {
      return { status: 'ERROR', summary: `could not inspect ${config.path}: ${found.message}`, evidence };
    }
    if (found.kind !== 'file') {
      return { status: 'ERROR', summary: `${config.path} is not a regular file`, evidence };
    }

    const absolute = resolveInProject(context.projectRoot, config.path);
    const size = (await stat(absolute)).size;
    evidence.sizeBytes = size;
    if (size > MAX_CONTENT_FILE_BYTES) {
      return {
        status: 'ERROR',
        summary: `${config.path} is larger than ${MAX_CONTENT_FILE_BYTES / (1024 * 1024)} MB; content checks are limited to smaller files`,
        evidence,
      };
    }

    const raw = await readFile(absolute, 'utf8');
    const normalize = (text: string): string => (config.ignoreCase ? text.toLowerCase() : text);
    const lines = normalize(raw).split(/\r\n|\r|\n/);
    const haystack = lines.join('\n');

    const missingText = config.contains.filter((needle) => !haystack.includes(normalize(needle)));
    const forbiddenFound = config.notContains
      .map((needle) => ({ text: needle, lines: matchingLines(lines, normalize(needle)) }))
      .filter((match) => match.lines.length > 0);

    Object.assign(evidence, {
      requiredFound: config.contains.length - missingText.length,
      requiredTotal: config.contains.length,
      missingText,
      forbiddenFound,
    });

    if (missingText.length === 0 && forbiddenFound.length === 0) {
      return {
        status: 'PASS',
        summary: `${config.contains.length} required and ${config.notContains.length} forbidden text rule(s) satisfied`,
        evidence,
      };
    }

    const details: string[] = [];
    for (const text of missingText) details.push(`missing required text: ${JSON.stringify(text)}`);
    for (const match of forbiddenFound) {
      const lineList = capList(match.lines.map(String), MAX_LINES_REPORTED).join(', ');
      details.push(`forbidden text ${JSON.stringify(match.text)} found on line(s) ${lineList}`);
    }
    const parts: string[] = [];
    if (missingText.length) parts.push(`${missingText.length} required text(s) missing`);
    if (forbiddenFound.length) parts.push(`${forbiddenFound.length} forbidden text(s) present`);
    return { status: 'FAIL', summary: `${config.path}: ${parts.join(', ')}`, details, evidence };
  },
};
