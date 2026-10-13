import type { FilesCheckConfig } from '../../types/index.js';
import type { CheckDefinition, CheckOutcome } from '../definition.js';
import { locate } from './locate.js';

export const filesCheck: CheckDefinition<FilesCheckConfig> = {
  type: 'files',
  description: 'Requires listed paths to exist (mustExist) or to be absent (mustNotExist).',

  parse(reader, base) {
    const config: FilesCheckConfig = {
      ...base,
      type: 'files',
      mustExist: reader.pathArray('mustExist'),
      mustNotExist: reader.pathArray('mustNotExist'),
    };
    if (!reader.has('mustExist') && !reader.has('mustNotExist')) {
      reader.issue('mustExist', 'a files check needs at least one of "mustExist" or "mustNotExist"');
    }
    return config;
  },

  describe(config) {
    const parts: string[] = [];
    if (config.mustExist.length) parts.push(`exist: ${config.mustExist.join(', ')}`);
    if (config.mustNotExist.length) parts.push(`absent: ${config.mustNotExist.join(', ')}`);
    return parts.join('; ');
  },

  async run(config, context): Promise<CheckOutcome> {
    const present: string[] = [];
    const missing: string[] = [];
    const forbiddenPresent: string[] = [];
    const caseMismatches: { expected: string; actual: string }[] = [];
    const unreadable: string[] = [];
    const details: string[] = [];

    for (const rel of config.mustExist) {
      const found = await locate(context.projectRoot, rel);
      if (found.state === 'present') present.push(rel);
      else if (found.state === 'missing') {
        missing.push(rel);
        details.push(`missing: ${rel}`);
      } else if (found.state === 'case-mismatch') {
        caseMismatches.push({ expected: rel, actual: found.actual });
        details.push(`case mismatch: expected ${rel}, found ${found.actual} (fails on case-sensitive file systems)`);
      } else {
        unreadable.push(rel);
        details.push(`could not inspect ${rel}: ${found.message}`);
      }
    }

    for (const rel of config.mustNotExist) {
      const found = await locate(context.projectRoot, rel);
      if (found.state === 'present') {
        forbiddenPresent.push(rel);
        details.push(`should not exist: ${rel}`);
      } else if (found.state === 'case-mismatch') {
        caseMismatches.push({ expected: rel, actual: found.actual });
        details.push(`${found.actual} exists and matches forbidden ${rel} on case-insensitive file systems`);
      } else if (found.state === 'unreadable') {
        unreadable.push(rel);
        details.push(`could not inspect ${rel}: ${found.message}`);
      }
    }

    const evidence = { present, missing, forbiddenPresent, caseMismatches, unreadable };
    const total = config.mustExist.length + config.mustNotExist.length;

    if (missing.length || forbiddenPresent.length) {
      const parts: string[] = [];
      if (missing.length) parts.push(`${missing.length} missing`);
      if (forbiddenPresent.length) parts.push(`${forbiddenPresent.length} present but forbidden`);
      return { status: 'FAIL', summary: parts.join(', '), details, evidence };
    }
    if (unreadable.length) {
      return { status: 'ERROR', summary: `${unreadable.length} path(s) could not be inspected`, details, evidence };
    }
    if (caseMismatches.length) {
      return {
        status: 'WARNING',
        summary: `${caseMismatches.length} path(s) differ only by letter case`,
        details,
        evidence,
      };
    }
    return { status: 'PASS', summary: `all ${total} path rule(s) satisfied`, evidence };
  },
};
