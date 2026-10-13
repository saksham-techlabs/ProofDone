// Cross-platform removal of build output directories (relative to the repository root only).
import { rmSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const root = process.cwd();
for (const target of process.argv.slice(2)) {
  const full = resolve(root, target);
  const rel = relative(root, full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    console.error(`clean: refusing to remove path outside the repository: ${target}`);
    process.exit(1);
  }
  rmSync(full, { recursive: true, force: true });
}
