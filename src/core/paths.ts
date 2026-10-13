import path from 'node:path';

/**
 * Validates a config path that must be relative to the project root and stay inside it.
 * Both `/` and `\` are accepted as separators so configs are portable across platforms.
 * Returns an error message, or `undefined` when the path is acceptable.
 */
export function checkProjectRelativePath(input: string): string | undefined {
  if (input.trim().length === 0) return 'must not be empty';
  if (input.includes('\0')) return 'must not contain NUL characters';
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    return 'must be relative to the project root (absolute paths are not allowed)';
  }
  const normalized = toPosixPath(input);
  if (normalized === '..' || normalized.startsWith('../')) {
    return 'must stay inside the project root';
  }
  return undefined;
}

/** Normalizes a relative path to forward slashes without `.` segments. */
export function toPosixPath(input: string): string {
  const normalized = path.posix.normalize(input.replace(/\\/g, '/'));
  return normalized.replace(/\/+$/, '') || '.';
}

/** Resolves a validated, project-relative config path to an absolute platform path. */
export function resolveInProject(projectRoot: string, relativePath: string): string {
  const segments = toPosixPath(relativePath).split('/');
  return path.resolve(projectRoot, ...segments);
}

/** Formats an absolute path relative to the project root for display (forward slashes). */
export function displayPath(projectRoot: string, absolutePath: string): string {
  const rel = path.relative(projectRoot, absolutePath);
  return rel === '' ? '.' : rel.split(path.sep).join('/');
}
