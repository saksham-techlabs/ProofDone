import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { realPathInProject } from '../../core/paths.js';

export type Presence =
  | { state: 'present'; kind: 'file' | 'directory' | 'other' }
  | { state: 'missing' }
  /** Exists only with different letter case (works on Windows/macOS, breaks on Linux). */
  | { state: 'case-mismatch'; actual: string }
  | { state: 'unreadable'; message: string };

async function kindOf(target: string): Promise<'file' | 'directory' | 'other'> {
  const info = await stat(target);
  if (info.isFile()) return 'file';
  if (info.isDirectory()) return 'directory';
  return 'other';
}

/**
 * Locates a normalized, project-relative path, comparing names case-sensitively on
 * every platform so results match what a Linux CI machine would see.
 */
export async function locate(projectRoot: string, relativePath: string): Promise<Presence> {
  const segments = relativePath.split('/').filter((segment) => segment !== '.' && segment !== '');
  let current = projectRoot;
  const actual: string[] = [];
  let mismatch = false;

  for (const segment of segments) {
    let names: string[];
    try {
      names = await readdir(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'missing' };
      return { state: 'unreadable', message: `cannot read directory: ${code ?? 'unknown error'}` };
    }
    let match = names.find((name) => name === segment);
    if (match === undefined) {
      match = names.find((name) => name.toLowerCase() === segment.toLowerCase());
      if (match === undefined) return { state: 'missing' };
      mismatch = true;
    }
    actual.push(match);
    current = path.join(current, match);
    try {
      if ((await lstat(current)).isSymbolicLink()) await realPathInProject(projectRoot, current);
    } catch (error) {
      return { state: 'unreadable', message: error instanceof Error ? error.message : 'cannot inspect path' };
    }
  }

  if (mismatch) return { state: 'case-mismatch', actual: actual.join('/') };
  try {
    return { state: 'present', kind: await kindOf(current) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'missing' };
    return { state: 'unreadable', message: `cannot inspect path: ${code ?? 'unknown error'}` };
  }
}
