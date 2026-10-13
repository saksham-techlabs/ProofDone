import { readFile, stat } from 'node:fs/promises';
import { capList } from '../../core/output.js';
import { realPathInProject, resolveInProject } from '../../core/paths.js';
import type { FileContentCheckConfig } from '../../types/index.js';
import type { CheckDefinition, CheckOutcome } from '../definition.js';
import { locate } from './locate.js';

export const MAX_CONTENT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LINES_REPORTED = 10;

/** 1-based line numbers on which `needle` occurs. Matched text itself is never reported. */
function matchingLines(haystack: string, needle: string): number[] {
  const result: number[] = [];
  let line = 1;
  let scanned = 0;
  let position = haystack.indexOf(needle);
  while (position !== -1) {
    for (; scanned < position; scanned++) if (haystack[scanned] === '\n') line++;
    if (result.at(-1) !== line) result.push(line);
    position = haystack.indexOf(needle, position + 1);
  }
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
    if (config.contains.length + config.notContains.length === 0) {
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

    const absolute = await realPathInProject(context.projectRoot, resolveInProject(context.projectRoot, config.path));
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
    const normalize = (text: string): string => {
      const normalized = text.replace(/\r\n?/g, '\n');
      return config.ignoreCase ? normalized.toLowerCase() : normalized;
    };
    const haystack = normalize(raw);

    const missingText = config.contains.filter((needle) => !haystack.includes(normalize(needle)));
    const forbiddenFound = config.notContains
      .map((needle) => ({ text: needle, lines: matchingLines(haystack, normalize(needle)) }))
      .filter((match) => match.lines.length > 0);

    Object.assign(evidence, {
      requiredFound: config.contains.length - missingText.length,
      requiredTotal: config.contains.length,
      missingText,
      forbiddenFound,
    });

    if (missingText.length === 0 && forbiddenFound.length === 0) {
      const parts: string[] = [];
      if (config.contains.length) parts.push(`${config.contains.length} required text(s) found`);
      if (config.notContains.length) parts.push(`${config.notContains.length} forbidden text(s) absent`);
      return { status: 'PASS', summary: `${config.path}: ${parts.join(', ')}`, evidence };
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
