# Contributing to ProofDone

Thanks for your interest in improving ProofDone. Bug reports, documentation fixes and new check
types are all welcome.

## Development setup

Development requirements: Node.js 22.13+ in the 22.x line, or Node.js 24+, and git (ESLint's
development requirement is stricter than the packaged CLI's Node.js 22+ minimum).
Docker is optional; the Docker check is tested with a
stand-in executable.

```bash
npm ci
npm run check      # typecheck + lint + tests + build + config self-check
```

Individual scripts:

| Script              | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `tests/`                        |
| `npm run lint`      | ESLint with typescript-eslint (strict)                         |
| `npm test`          | Compiles to `.test-build/` and runs `node --test`              |
| `npm run build`     | Compiles `src/` to `dist/`                                     |
| `npm run selfcheck` | Validates this repository's own `proofdone.config.json`        |
| `npm run smoke` | Builds, packs, installs locally, and tests the packaged CLI executable |

Run the CLI locally with `node dist/cli/main.js <command>` after building, or `npm link`.

ProofDone verifies itself: after `npm run build`, `node dist/cli/main.js verify` runs this
repository's own checks.

## Project principles

Please keep these in mind. Changes that break them are unlikely to be merged.

1. **Evidence first.** Never report `PASS` for something that was not actually inspected. If a
   check cannot see what it needs, it returns `NOT_CHECKED` with a reason.
2. **Verify, don't mutate.** Checks must not modify the project, the repository, or external
   systems. No auto-fixes, no `git fetch`, no starting services.
3. **Cross-platform.** Everything must work on Windows, Linux and macOS. Use `node:path`, avoid
   shell-specific syntax in code, and test path handling with both separators.
4. **Minimal dependencies.** Prefer Node built-ins. New runtime dependencies need a strong reason.
5. **Clear output.** Every non-PASS result should tell the user what to look at next.

## Adding a check type

See [docs/architecture.md](docs/architecture.md#adding-a-check-type). In short: add a config type,
implement `CheckDefinition`, register it, update the JSON schema and the README, and add tests.

## Tests

- Tests use Node's built-in test runner and live in `tests/`.
- Prefer real resources: temporary directories, real git repositories, real child processes and
  local HTTP servers. Use `makeTempDir()` / `removeDir()` from `tests/helpers.ts`.
- Tests must pass on Windows and Linux (CI runs both, plus macOS).

## Pull requests

- Keep changes focused, and explain the motivation in the description.
- Add or update tests and docs alongside code changes.
- Add an entry under "Unreleased" in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- Make sure `npm run check` passes.

## Reporting bugs

Please include your OS, Node.js version, the ProofDone version (`proofdone --version`), the
relevant part of your config, and the output of `proofdone verify --json` if possible. Remove
anything sensitive first.

For security issues, see [SECURITY.md](SECURITY.md) instead of opening a public issue.
