import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CHECK_TYPES } from '../src/checks/registry.js';
import { loadConfig } from '../src/config/load.js';
import { VERSION } from '../src/version.js';
import { REPO_ROOT } from './helpers.js';

async function readJson<T>(rel: string): Promise<T> {
  return JSON.parse(await readFile(path.join(REPO_ROOT, rel), 'utf8')) as T;
}

describe('repository consistency', () => {
  it('VERSION matches package.json', async () => {
    const pkg = await readJson<{ version: string }>('package.json');
    assert.equal(VERSION, pkg.version);
  });

  it('JSON schema covers exactly the registered check types', async () => {
    const schema = await readJson<{ $defs: Record<string, { properties?: { type?: { const?: string } } }> }>(
      'schema/proofdone.schema.json',
    );
    const schemaTypes = Object.values(schema.$defs)
      .map((def) => def.properties?.type?.const)
      .filter((value): value is string => typeof value === 'string')
      .sort();
    assert.deepEqual(schemaTypes, [...CHECK_TYPES].sort());
  });

  it('README documents every check type', async () => {
    const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');
    for (const type of CHECK_TYPES) assert.ok(readme.includes(`\`${type}\``), `README is missing ${type}`);
  });

  it('the repository config and every example config are valid', async () => {
    const configs = ['proofdone.config.json'];
    for (const entry of await readdir(path.join(REPO_ROOT, 'examples'), { withFileTypes: true })) {
      if (entry.isDirectory()) configs.push(path.join('examples', entry.name, 'proofdone.config.json'));
    }
    assert.ok(configs.length >= 3);
    for (const config of configs) {
      const loaded = await loadConfig(path.join(REPO_ROOT, config));
      assert.ok(loaded.config.checks.length > 0, config);
    }
  });
});
