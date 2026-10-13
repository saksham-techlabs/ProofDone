# Architecture

ProofDone is a small TypeScript CLI with no runtime dependencies. It uses Node's built-in
`child_process`, `fs`, `fetch`, `util.parseArgs` and `node:test`.

```text
src/
  cli/            argument parsing, help text, and the init / verify / validate commands
    main.ts       executable entry point (signal handling, exit code)
    run.ts        runCli(argv, io) -> exit code; testable without spawning a process
  config/
    reader.ts     FieldReader: typed reads from untrusted JSON, collects issues, rejects unknown keys
    validate.ts   validates the whole config, delegating type-specific fields to check definitions
    load.ts       reads + parses + validates a config file
    starter.ts    builds the config written by `init`
  checks/
    definition.ts the CheckDefinition interface every check type implements
    registry.ts   maps a type name to its definition
    command/      command check
    git/          git-repo, git-clean, git-branch, git-upstream (one porcelain-v2 parser)
    files/        files and file-content checks (case-exact path lookup)
    http/         http check
    docker/       docker check
  core/
    process.ts    runProcess: timeouts, process-tree kill, bounded output capture
    output.ts     ANSI stripping, secret redaction, output tails, formatting
    paths.ts      project-relative path validation and resolution
    runner.ts     runs checks sequentially and assembles the report
    verdict.ts    verdict rules and exit codes
    errors.ts     ProofDoneError (expected errors, exit code 2)
  reporters/      text (ASCII, optional color) and JSON reporters
  types/          shared types: configs, statuses, results, report
```

## Flow

```text
argv -> runCli -> loadConfig -> validateConfig -> runVerification -> computeVerdict -> reporter -> exit code
                                    |                    |
                           CheckDefinition.parse   CheckDefinition.run
```

## Adding a check type

1. Add a config interface to `src/types/index.ts` and include it in the `CheckConfig` union.
2. Create `src/checks/<area>/<name>-check.ts` exporting a `CheckDefinition`:
   - `parse(reader, base)` reads and validates the type-specific fields. Use `FieldReader`
     methods so unknown keys and bad values are reported consistently.
   - `describe(config)` gives the one-line description shown by `proofdone validate`.
   - `run(config, context)` returns `{ status, summary, details?, evidence? }`. It must not
     modify the project, and it must return `NOT_CHECKED` (never `PASS`) when it cannot inspect
     what it needs.
3. Register it in `src/checks/registry.ts`. The `DefinitionMap` type makes a missing entry a
   compile error.
4. Add it to `schema/proofdone.schema.json` and the README; `tests/repository.test.ts` fails
   until both are updated.
5. Add tests that run against real resources (temporary directories, real processes, local
   servers) wherever practical.

## Design decisions

- **Sequential execution.** Build and test commands often compete for CPU or for the same output
  directories. Running checks in a fixed order also makes the output deterministic.
- **Shell commands as strings.** Users write the same `npm run build` they would type. Commands
  run through the platform shell, so `npm` (a `.cmd` file on Windows) works everywhere.
- **No auto-start, no fetch, no fixes.** Anything that changes state belongs to the user or the
  agent, not to the verifier.
- **Injectable tool paths.** `CheckContext.tools` lets tests point git/docker checks at
  stand-in executables. Tests still spawn real processes rather than mocking functions.
