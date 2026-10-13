#!/usr/bin/env node
import { killActiveProcesses } from '../core/process.js';
import { runCli } from './run.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  process.stderr.write(`proofdone requires Node.js 22 or newer (found ${process.versions.node}).\n`);
  process.exit(2);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    killActiveProcesses();
    process.stderr.write(`\nproofdone: interrupted (${signal}); verification incomplete.\n`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

const exitCode = await runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
  env: process.env,
});
process.exitCode = exitCode;
