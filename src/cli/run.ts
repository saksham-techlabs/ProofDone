import { parseArgs, type ParseArgsConfig } from 'node:util';
import { ProofDoneError, errorMessage } from '../core/errors.js';
import { EXIT_CODES } from '../core/verdict.js';
import { renderJsonError } from '../reporters/json.js';
import { VERSION } from '../version.js';
import { sanitizeOutput } from '../core/output.js';
import { runInit } from './commands/init.js';
import { runValidate } from './commands/validate.js';
import { runVerify } from './commands/verify.js';
import { INIT_HELP, MAIN_HELP, VALIDATE_HELP, VERIFY_HELP } from './help.js';
import type { CliIO } from './io.js';

type Options = NonNullable<ParseArgsConfig['options']>;

const HELP_OPTION: Options = { help: { type: 'boolean', short: 'h' } };
const LOCATION_OPTIONS: Options = { cwd: { type: 'string' }, config: { type: 'string' } };

const COMMAND_OPTIONS: Record<string, Options> = {
  init: { ...HELP_OPTION, ...LOCATION_OPTIONS, force: { type: 'boolean' } },
  verify: {
    ...HELP_OPTION,
    ...LOCATION_OPTIONS,
    json: { type: 'boolean' },
    only: { type: 'string' },
    strict: { type: 'boolean' },
    quiet: { type: 'boolean' },
    'no-color': { type: 'boolean' },
  },
  validate: { ...HELP_OPTION, ...LOCATION_OPTIONS, json: { type: 'boolean' } },
};

const COMMAND_HELP: Record<string, string> = { init: INIT_HELP, verify: VERIFY_HELP, validate: VALIDATE_HELP };

function parse(args: string[], options: Options): Record<string, string | boolean | undefined> {
  try {
    const { values, positionals } = parseArgs({ args, options, strict: true, allowPositionals: true });
    if (positionals.length > 0) {
      throw new ProofDoneError('USAGE', `Unexpected argument: ${positionals[0]}`);
    }
    return values as Record<string, string | boolean | undefined>;
  } catch (error) {
    if (error instanceof ProofDoneError) throw error;
    throw new ProofDoneError('USAGE', errorMessage(error));
  }
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Runs the CLI and resolves to the process exit code. Never throws.
 */
export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  const [command, ...rest] = argv;
  const wantsJson = rest.includes('--json');

  try {
    if (command === undefined) {
      io.stderr.write(MAIN_HELP);
      return EXIT_CODES.ERROR;
    }
    if (command === '-h' || command === '--help' || command === 'help') {
      io.stdout.write(MAIN_HELP);
      return 0;
    }
    if (command === '-v' || command === '--version' || command === 'version') {
      io.stdout.write(`${VERSION}\n`);
      return 0;
    }

    const optionSpec = COMMAND_OPTIONS[command];
    if (!optionSpec) {
      throw new ProofDoneError('USAGE', `Unknown command "${command}". Run "proofdone --help" for usage.`);
    }
    const values = parse(rest, optionSpec);
    if (values.help) {
      io.stdout.write(COMMAND_HELP[command] ?? MAIN_HELP);
      return 0;
    }

    const cwd = str(values.cwd) ?? '.';
    const config = str(values.config);
    const location = config === undefined ? { cwd } : { cwd, config };

    switch (command) {
      case 'init':
        return await runInit({ ...location, force: values.force === true }, io);
      case 'validate':
        return await runValidate({ ...location, json: values.json === true }, io);
      default: {
        const only = str(values.only);
        return await runVerify(
          {
            ...location,
            ...(only === undefined ? {} : { only }),
            json: values.json === true,
            strict: values.strict === true,
            quiet: values.quiet === true,
            noColor: values['no-color'] === true,
          },
          io,
        );
      }
    }
  } catch (error) {
    const known = error instanceof ProofDoneError;
    const code = known ? error.code : 'INTERNAL';
    const message = known ? error.message : `Unexpected error: ${errorMessage(error)}`;
    const issues = known ? error.issues : [];
    if (wantsJson) {
      io.stdout.write(renderJsonError(code, message, issues));
    } else {
      io.stderr.write(sanitizeOutput(`proofdone: ${message}\n`));
      for (const issue of issues) io.stderr.write(sanitizeOutput(`  - ${issue.path}: ${issue.message}\n`));
      if (code === 'USAGE') io.stderr.write('Run "proofdone --help" for usage.\n');
    }
    return EXIT_CODES.ERROR;
  }
}
