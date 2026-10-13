import { CHECK_TYPES, getDefinition } from '../checks/registry.js';
import { VERSION } from '../version.js';

export const MAIN_HELP = `ProofDone ${VERSION} - evidence-based verification for AI coding agents.

The agent says "done". ProofDone asks "prove it".

Usage:
  proofdone <command> [options]

Commands:
  init        Create a starter proofdone.config.json for this project
  verify      Run the configured checks and print an evidence-based verdict
  validate    Validate the config and list what verify would run (runs nothing)

Global options:
  -h, --help       Show help (use "proofdone <command> --help" for details)
  -v, --version    Print the version

Exit codes:
  0  DONE        every required check passed
  1  NOT DONE    a required check failed or errored
  2  ERROR       usage, configuration or internal error
  3  UNVERIFIED  a required check could not be verified (NOT CHECKED)

Docs: see README.md and docs/ in the ProofDone repository.
`;

export const INIT_HELP = `Usage: proofdone init [options]

Creates proofdone.config.json based on what exists in the project
(package.json scripts, README/LICENSE, .git). Never overwrites an existing
config unless --force is given. This is the only command that writes a file.

Options:
  --cwd <dir>       Project directory (default: current directory)
  --config <file>   Config file to create (default: proofdone.config.json)
  --force           Overwrite an existing config file
  -h, --help        Show this help
`;

export const VERIFY_HELP = `Usage: proofdone verify [options]

Runs every configured check and prints the evidence and a final verdict.
Commands in "command" checks are executed exactly as written in the config:
review configs from untrusted repositories before running verify
(use "proofdone validate" to list them without running anything).

Options:
  --cwd <dir>        Directory to look for the config in (default: current directory)
  --config <file>    Config file (default: proofdone.config.json); relative paths
                     inside it resolve against the config file's directory
  --json             Print a machine-readable JSON report to stdout
  --only <ids>       Run only these check ids (comma-separated)
  --strict           Treat WARNING on required checks as NOT DONE
  --quiet            Do not print progress lines to stderr
  --no-color         Disable colored output (NO_COLOR is also honored)
  -h, --help         Show this help

Check types:
${CHECK_TYPES.map((type) => `  ${type.padEnd(14)} ${getDefinition(type).description}`).join('\n')}
`;

export const VALIDATE_HELP = `Usage: proofdone validate [options]

Validates the config and prints every check, including the exact commands
that "verify" would execute. Nothing is executed.

Options:
  --cwd <dir>        Directory to look for the config in (default: current directory)
  --config <file>    Config file (default: proofdone.config.json)
  --json             Print the result as JSON
  -h, --help         Show this help
`;
