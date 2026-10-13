<h1 align="center">ProofDone</h1>

<p align="center">
  <strong>Evidence-based verification for AI coding agents.</strong><br>
  The agent says <em>"Done."</em> ProofDone asks <em>"Prove it."</em>
</p>

<p align="center">
  TypeScript &middot; Node.js 22+ &middot; zero runtime dependencies &middot; Windows, Linux, macOS &middot; MIT
</p>

---

```text
$ proofdone verify

ProofDone Verification
Project: /home/dev/acme-api
Config:  proofdone.config.json

  Typecheck                 PASS         exit 0 in 3.1s
  Lint                      PASS         exit 0 in 2.4s
  Tests                     PASS         exit 0 in 8.7s
  Build                     PASS         exit 0 in 5.2s
  Required files            PASS         all 5 path rule(s) satisfied
  HTTP health endpoint      PASS         200 in 14ms
  Git working tree          FAIL         working tree has uncommitted changes: 2 unstaged, 1 untracked
  Docker health (optional)  NOT CHECKED  Docker CLI not found on PATH

Evidence
  FAIL  Git working tree
      unstaged: src/routes/users.ts
      unstaged: src/db/schema.ts
      untracked: src/routes/users.test.ts

6 passed, 1 failed, 0 warnings, 1 not checked, 0 errors (8 checks in 19.6s)

Final verdict: NOT DONE
Reason: Required check failed: Git working tree (working tree has uncommitted changes: 2 unstaged, 1 untracked).
```

<sub>Illustrative output. Project names, timings and file names are examples.</sub>

## Contents

- [What is ProofDone?](#what-is-proofdone)
- [The problem](#the-problem)
- [A real-world example](#a-real-world-example)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Check types](#check-types)
- [CLI commands](#cli-commands)
- [Verdicts and exit codes](#verdicts-and-exit-codes)
- [JSON output](#json-output)
- [Security and safety model](#security-and-safety-model)
- [Using ProofDone in CI](#using-proofdone-in-ci)
- [Using ProofDone with AI agents](#using-proofdone-with-ai-agents)
- [Limitations](#limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## What is ProofDone?

ProofDone is a command-line tool that independently checks the claims an AI coding agent
(Cursor, Codex, Claude Code, or any other) makes when it reports that a task is finished:

| The agent claims...           | ProofDone checks...                                             |
| ----------------------------- | --------------------------------------------------------------- |
| "The build passes"            | runs your build command and records the exit code and output    |
| "All tests pass"              | runs your test command                                          |
| "No uncommitted changes"      | reads `git status` and lists every staged/unstaged/untracked file |
| "I pushed the branch"         | compares the branch with its upstream tracking ref              |
| "The README and LICENSE exist"| checks the paths on disk, with exact letter case                |
| "I removed the placeholders"  | searches files for forbidden text and reports line numbers     |
| "The service is running"      | requests your health endpoint and checks status and body        |
| "The container is healthy"    | runs `docker inspect` and reads the container's health status   |

Each check reports **PASS**, **FAIL**, **WARNING**, **NOT CHECKED** or **ERROR** with the evidence
behind it, and the run ends with one verdict: **DONE**, **NOT DONE** or **UNVERIFIED**.

ProofDone is **evidence-first**: if it cannot inspect something (Docker is not installed, git is
missing, a branch has no upstream), the result is **NOT CHECKED**, never PASS.

## The problem

AI agents are good at writing code and not always reliable when they report on it. "Tests pass"
may mean the agent ran one test file, ran the tests before its last edit, or did not run them at
all. Checking by hand means rerunning the same commands after every task.

ProofDone turns "done" into something you can check. You describe once, in a small JSON file,
what "done" means for your project. After that, you, your CI or the agent itself can run
`proofdone verify` and get the same answer from the real project state.

## A real-world example

An agent finishes a feature in a Node.js API and replies:

> Done! I added the `/users` endpoint, all tests pass and the build is clean.

You run `proofdone verify` and see the report at the top of this page. The build, tests and
health endpoint check out. The work, though, is not committed: two files are modified and the
new test file is untracked. The verdict is **NOT DONE** and the exit code is `1`, so a script or
CI job can act on it.

See [`examples/`](examples) for complete configurations for a
[Node.js API](examples/node-api) and a [Next.js app](examples/nextjs).

## Installation

ProofDone requires **Node.js 22 or newer**.

> **Not yet published to npm.** The package is prepared for publication under the name
> `proofdone`; until then, install it from source. After publication the intended usage is
> `npx proofdone verify` or `npm install --save-dev proofdone`.

From source:

```bash
git clone <repository-url> proofdone
cd proofdone
npm ci
npm run build
npm link          # optional: puts `proofdone` on your PATH
```

Without `npm link`, run the CLI directly: `node /path/to/proofdone/dist/cli/main.js verify`.

## Quick start

```bash
cd your-project
proofdone init       # creates proofdone.config.json from what exists in the project
proofdone validate   # shows every check and the exact commands verify will run
proofdone verify     # runs the checks and prints the verdict
```

`init` looks at your project and adds only checks it can back up:

- `typecheck`, `lint`, `build` and `test` scripts from `package.json` (using npm, pnpm, yarn or
  bun based on the lockfile)
- a `files` check for `README.md`, `package.json` and `LICENSE`, whichever of them exist
- a `git-clean` check if the project has a `.git` directory

`init` never overwrites an existing config unless you pass `--force`.

## Configuration

The config file is `proofdone.config.json` in the project root (override with `--config`).
**All relative paths in the config resolve against the directory that contains the config file**,
and may not point outside it.

```json
{
  "version": 1,
  "checks": [
    { "id": "build", "name": "Build", "type": "command", "command": "npm run build" },
    { "id": "tests", "name": "Tests", "type": "command", "command": "npm test" },
    { "id": "git-clean", "name": "Git working tree", "type": "git-clean" },
    {
      "id": "required-files",
      "name": "Required files",
      "type": "files",
      "mustExist": ["README.md", "LICENSE", ".env.example"],
      "mustNotExist": [".env"]
    },
    {
      "id": "health",
      "name": "HTTP health endpoint",
      "type": "http",
      "url": "http://localhost:3000/api/health",
      "bodyContains": "ok"
    },
    {
      "id": "db",
      "name": "Database container",
      "type": "docker",
      "container": "acme-postgres",
      "expect": "healthy",
      "required": false
    }
  ]
}
```

Every check accepts these common fields:

| Field       | Required | Description                                                                 |
| ----------- | -------- | --------------------------------------------------------------------------- |
| `id`        | yes      | Unique id: letters, digits, `.`, `_`, `-` (used by `--only` and JSON output) |
| `type`      | yes      | One of the check types below                                                |
| `name`      | no       | Display name (defaults to `id`)                                             |
| `required`  | no       | Whether the check affects the verdict (default `true`)                      |
| `timeoutMs` | no       | Per-check timeout in milliseconds                                           |

The config is validated before anything runs. Unknown fields are rejected, which catches typos
such as `"comand"`. All problems are reported at once:

```text
proofdone: Config proofdone.config.json is invalid (2 issue(s)).
  - checks[0].type: unknown check type "comand" (expected one of: command, git-repo, ...)
  - checks[1].id: is required
```

A JSON Schema for editor completion ships at `schema/proofdone.schema.json`. Once the package
is installed locally you can reference it with
`"$schema": "./node_modules/proofdone/schema/proofdone.schema.json"`.

The full reference is in [docs/configuration.md](docs/configuration.md).

## Check types

| Type           | Verifies                                                        | Key options                                          |
| -------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| `command`      | A shell command exits with the expected code                    | `command`, `cwd`, `env`, `expectExitCode` (0)        |
| `git-repo`     | The project is inside a git repository (reports branch, HEAD)   |                                                      |
| `git-clean`    | No staged, unstaged, conflicted or untracked changes            | `allowUntracked` (false: untracked files fail)       |
| `git-branch`   | The current branch has the expected name                        | `expected`                                           |
| `git-upstream` | The branch is neither ahead of nor behind its upstream          | `allowAhead`, `allowBehind`                          |
| `files`        | Paths exist / do not exist (exact letter case)                  | `mustExist`, `mustNotExist`                          |
| `file-content` | A file contains required text / does not contain forbidden text | `path`, `contains`, `notContains`, `ignoreCase`      |
| `http`         | A URL responds with the expected status and body                | `url`, `method` (GET/HEAD), `expectStatus`, `bodyContains` |
| `docker`       | A container exists, is running, or is healthy                   | `container`, `expect` (`exists`/`running`/`healthy`) |

How each check handles the cases it cannot verify:

| Situation                                           | Status          |
| --------------------------------------------------- | --------------- |
| Command exits non-zero, times out, or is not found  | FAIL            |
| Command's working directory is missing              | ERROR           |
| git is not installed                                | NOT CHECKED     |
| Project is not a git repository                     | FAIL            |
| Branch has no upstream / upstream not fetched       | NOT CHECKED     |
| Untracked files with `allowUntracked: true`         | WARNING         |
| Path exists only with different letter case         | WARNING         |
| HTTP connection refused or timed out                | FAIL            |
| Docker CLI missing or daemon unreachable            | NOT CHECKED     |
| Container has no HEALTHCHECK but `expect: healthy`  | NOT CHECKED     |
| File too large for content checks (> 5 MB)          | ERROR           |

## CLI commands

```text
proofdone init       [--cwd <dir>] [--config <file>] [--force]
proofdone verify     [--cwd <dir>] [--config <file>] [--json] [--only <ids>] [--strict] [--quiet] [--no-color]
proofdone validate   [--cwd <dir>] [--config <file>] [--json]
proofdone --help | <command> --help
proofdone --version
```

| Option        | Description                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| `--json`      | Machine-readable report on stdout (no progress output)                      |
| `--only`      | Comma-separated check ids to run, e.g. `--only build,tests`                 |
| `--strict`    | Treat WARNING on a required check as NOT DONE                               |
| `--quiet`     | Do not print `[1/5] Build ...` progress lines (they go to stderr)           |
| `--no-color`  | Disable colors. Colors are only used on a terminal; `NO_COLOR` disables and `FORCE_COLOR` enables them |
| `--force`     | `init` only: overwrite an existing config                                   |

`validate` runs nothing. It confirms the config is valid and lists every command that `verify`
would execute, which is useful before running ProofDone in a repository you did not write.

## Verdicts and exit codes

Only checks with `required: true` (the default) affect the verdict. The rules apply in order:

1. Any required check is **FAIL** or **ERROR**: verdict **NOT DONE**
2. Any required check is **NOT CHECKED**: verdict **UNVERIFIED**
3. With `--strict`, any required check is **WARNING**: verdict **NOT DONE**
4. Otherwise: verdict **DONE** (warnings and failing optional checks are mentioned in the reason)

| Exit code | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `0`       | **DONE**: every required check passed                                        |
| `1`       | **NOT DONE**: a required check failed or errored                             |
| `2`       | Usage, configuration or internal error: verification did not run             |
| `3`       | **UNVERIFIED**: nothing failed, but a required check could not be verified   |

UNVERIFIED has its own exit code so that "could not check" is never mistaken for "passed".
Details: [docs/verdict-model.md](docs/verdict-model.md).

## JSON output

`proofdone verify --json` prints a single JSON document to stdout:

```json
{
  "tool": "proofdone",
  "version": "0.1.0",
  "reportVersion": 1,
  "projectRoot": "/home/dev/acme-api",
  "configPath": "/home/dev/acme-api/proofdone.config.json",
  "startedAt": "2026-10-14T09:30:00.000Z",
  "finishedAt": "2026-10-14T09:30:19.600Z",
  "durationMs": 19600,
  "strict": false,
  "verdict": "NOT_DONE",
  "reason": "Required check failed: Git working tree (working tree has uncommitted changes: 2 unstaged).",
  "summary": { "total": 2, "pass": 1, "fail": 1, "warning": 0, "notChecked": 0, "error": 0 },
  "checks": [
    {
      "id": "tests",
      "name": "Tests",
      "type": "command",
      "required": true,
      "status": "PASS",
      "summary": "exit 0 in 8.7s",
      "details": [],
      "evidence": {
        "command": "npm test",
        "cwd": ".",
        "exitCode": 0,
        "expectedExitCode": 0,
        "signal": null,
        "timedOut": false,
        "durationMs": 8712,
        "stdoutTail": ["# tests 42", "# pass 42", "# fail 0"],
        "stderrTail": [],
        "outputTruncated": false
      },
      "durationMs": 8715
    },
    {
      "id": "git-clean",
      "name": "Git working tree",
      "type": "git-clean",
      "required": true,
      "status": "FAIL",
      "summary": "working tree has uncommitted changes: 2 unstaged",
      "details": ["unstaged: src/routes/users.ts", "unstaged: src/db/schema.ts"],
      "evidence": {
        "branch": "main",
        "head": "9f2c1e4b7a3d5c6e8f9a0b1c2d3e4f5a6b7c8d9e",
        "upstream": "origin/main",
        "ahead": 0,
        "behind": 0,
        "staged": [],
        "unstaged": ["src/routes/users.ts", "src/db/schema.ts"],
        "untracked": [],
        "conflicted": [],
        "counts": { "staged": 0, "unstaged": 2, "untracked": 0, "conflicted": 0 }
      },
      "durationMs": 41
    }
  ],
  "exitCode": 1
}
```

<sub>Illustrative values. `evidence` fields differ by check type.</sub>

When verification cannot run (exit code 2), `--json` prints an error document instead:

```json
{
  "tool": "proofdone",
  "version": "0.1.0",
  "reportVersion": 1,
  "verdict": null,
  "exitCode": 2,
  "error": {
    "code": "CONFIG_INVALID",
    "message": "Config /path/proofdone.config.json is invalid (1 issue(s)).",
    "issues": [{ "path": "checks[0].command", "message": "is required" }]
  }
}
```

## Security and safety model

ProofDone is a **verifier**. It reads project state and reports on it. It does not:

- modify, format or fix source code
- delete files, commit, push, deploy, or start servers
- run `git fetch` or anything else that changes repository state. `git status` runs with
  `GIT_OPTIONAL_LOCKS=0`, so it does not even refresh the index.
- send network requests other than the `http` checks you configure (GET or HEAD only)

The only command that writes a file is `proofdone init`, which creates the config file and will
not overwrite an existing one without `--force`.

> **Important:** `command` checks run exactly the shell commands written in the config, with
> your user's permissions. A config from an untrusted repository can run anything. **Review the
> config before running `verify` in a repository you do not trust.** `proofdone validate` lists
> every command without executing it.

Other safeguards:

- Config paths must be relative and stay inside the project directory.
- Commands run with stdin closed, so an interactive prompt cannot hang verification. Each command
  has a timeout (default 10 minutes), and on timeout the whole process tree is terminated.
- Captured output is trimmed to its tail and passed through a best-effort redaction of common
  token formats (GitHub, OpenAI-style, AWS, Slack, npm, private keys, Bearer headers) and of any
  `env` values from the config. Redaction is a safety net, not a guarantee.
- `file-content` reports **line numbers** for forbidden text, never the matching lines.

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## Using ProofDone in CI

ProofDone exits non-zero unless the verdict is DONE, so it works as a single CI step:

```yaml
# .github/workflows/verify.yml
name: verify
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx proofdone verify   # after npm publication; until then, run from a source checkout
```

To keep the report as an artifact, run `proofdone verify --json > proofdone-report.json` and
upload the file. In CI, use `--only` to skip checks that only make sense locally (for example,
an `http` check against a dev server), or mark them `"required": false`.

## Using ProofDone with AI agents

Add an instruction like this to your agent rules (`AGENTS.md`, `.cursor/rules`, `CLAUDE.md`, ...):

```markdown
Before reporting a task as complete, run `npx proofdone verify --json`.
Only say the task is done if the verdict is "DONE". Otherwise, fix the failing
checks or report the verdict and the failing evidence verbatim.
```

Then verify the agent's claim yourself with `proofdone verify`. More patterns:
[docs/ai-agents.md](docs/ai-agents.md).

## Limitations

- **ProofDone checks what you configure.** A passing verdict means the configured checks passed.
  It does not mean the code is correct, secure, or that the tests are meaningful.
- Commands are run, not analyzed. If your test script exits 0 without running tests, the check
  passes.
- `git-upstream` compares against the last fetched remote state. It does not contact the remote.
- Checks run sequentially, one at a time.
- `file-content` matches literal text only (no regular expressions) in files up to 5 MB.
- `http` supports GET and HEAD without custom headers or authentication.
- `docker` inspects containers through the `docker` CLI only (no Compose service names, no Podman).
- Output redaction is best effort and pattern-based.
- Not yet published to npm (see [Installation](#installation)).

## Roadmap

Ideas under consideration. None of them are commitments:

- Optional parallel execution for independent checks
- Regex matching for `file-content`, and glob support for `files`
- `docker compose` service checks
- A SARIF or JUnit reporter for CI dashboards
- Config presets for common stacks
- A GitHub Action wrapper

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup,
the architecture overview and how to add a new check type. `npm run check` runs typecheck,
lint, tests, build and a config self-check.

## License

[MIT](LICENSE)
