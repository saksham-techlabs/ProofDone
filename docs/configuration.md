# Configuration reference

ProofDone reads `proofdone.config.json` from the current directory, or the file given with
`--config <file>`; `--cwd <dir>` changes where the default file is looked up.

- The **project root** is the directory that contains the config file.
- Every relative path in the config (`cwd`, `mustExist`, `path`, ...) resolves against the
  project root and must stay inside it. Absolute paths and `..` escapes are rejected.
- Both `/` and `\` work as path separators, so one config works on Windows, Linux and macOS.
- The file must be JSON (a UTF-8 byte-order mark is tolerated). Comments are not allowed.

## Top level

| Field     | Type   | Required | Description                                       |
| --------- | ------ | -------- | ------------------------------------------------- |
| `version` | `1`    | no       | Config format version. Only `1` exists.           |
| `checks`  | array  | yes      | One or more checks, run in order.                 |
| `$schema` | string | no       | Ignored by ProofDone; for editor completion only. |

Any other top-level key is an error.

## Common check fields

| Field       | Type    | Default | Description                                                            |
| ----------- | ------- | ------- | ---------------------------------------------------------------------- |
| `id`        | string  | -       | Required. 1-64 characters `[A-Za-z0-9._-]`, starting with a letter or digit. Must be unique. |
| `type`      | string  | -       | Required. See below.                                                   |
| `name`      | string  | `id`    | Display name in reports.                                               |
| `required`  | boolean | `true`  | If `false`, the result is reported but never affects the verdict.      |
| `timeoutMs` | integer | varies  | Timeout for this check (1 ms to 24 h).                                 |

Unknown fields on a check are errors, so typos fail loudly instead of being ignored.

## `command`

Runs a command through the platform shell (`cmd.exe` on Windows, `/bin/sh` elsewhere).

| Field            | Type             | Default    | Description                                     |
| ---------------- | ---------------- | ---------- | ----------------------------------------------- |
| `command`        | string           | -          | Required. The command line to run.              |
| `cwd`            | path             | `.`        | Working directory, relative to the project root. |
| `env`            | object of string | `{}`       | Extra environment variables (merged over the current environment). Values of 8+ characters are redacted from captured output. |
| `expectExitCode` | integer 0-255    | `0`        | Exit code that counts as PASS.                  |
| `timeoutMs`      | integer          | `600000`   | The process tree is killed after this time.     |

- **PASS**: the exit code equals `expectExitCode`.
- **FAIL**: any other exit code, killed by a signal, timed out, or command not found.
- **ERROR**: `cwd` does not exist, or the shell could not be started.

Evidence includes the exit code, duration, and the last 40 lines of stdout and stderr (ANSI
codes stripped, secrets redacted). stdin is closed, so commands that wait for input get end-of-file
instead of hanging.

Portability tip: shell syntax differs between `cmd.exe` and `sh`. Prefer package scripts
(`npm run build`) over inline shell constructs if the config must work on every OS.

## `git-repo`

No extra fields. PASS if the project root is inside a git work tree; the evidence includes the
repository root, branch, HEAD commit and upstream. FAIL if it is not a repository.
NOT CHECKED if git is not installed.

## `git-clean`

| Field            | Type    | Default | Description                                                    |
| ---------------- | ------- | ------- | -------------------------------------------------------------- |
| `allowUntracked` | boolean | `false` | If `true`, untracked files produce WARNING instead of FAIL.     |

Uses `git status --porcelain=v2 --untracked-files=all` for the whole repository (including when
the project root is a subdirectory). Ignored files (`.gitignore`) never count.

- **PASS**: no staged, unstaged, conflicted or untracked changes.
- **WARNING**: only untracked files, and `allowUntracked` is `true`.
- **FAIL**: anything else; every file is listed in the evidence (up to 20 shown in text output, 100 in JSON).

## `git-branch`

| Field      | Type   | Description                     |
| ---------- | ------ | ------------------------------- |
| `expected` | string | Required. Expected branch name. |

FAIL on any other branch or a detached HEAD.

## `git-upstream`

| Field         | Type    | Default | Description                                   |
| ------------- | ------- | ------- | --------------------------------------------- |
| `allowAhead`  | boolean | `false` | Allow local commits that are not pushed.      |
| `allowBehind` | boolean | `false` | Allow being behind the upstream.              |

Compares the branch with its upstream tracking ref (for example `origin/main`) **as of the last
fetch**. ProofDone never runs `git fetch`. Run it yourself first if you need current remote state.

- **NOT CHECKED**: detached HEAD, no upstream configured, or the upstream ref does not exist
  locally. "I can't tell" is never reported as "pushed".

## `files`

| Field          | Type          | Description                             |
| -------------- | ------------- | --------------------------------------- |
| `mustExist`    | array of path | Files or directories that must exist.   |
| `mustNotExist` | array of path | Files or directories that must not exist. |

At least one of the two is required. Names are compared **case-sensitively on every platform**:
if `README.md` is required but the file is `readme.md`, the check reports WARNING. Windows and
macOS would accept that name, but Linux (and most CI machines) would not.

## `file-content`

| Field         | Type            | Default | Description                               |
| ------------- | --------------- | ------- | ----------------------------------------- |
| `path`        | path            | -       | Required. File to read.                   |
| `contains`    | array of string | `[]`    | Literal texts that must all appear.       |
| `notContains` | array of string | `[]`    | Literal texts that must not appear.       |
| `ignoreCase`  | boolean         | `false` | Case-insensitive matching.                |

At least one of `contains` / `notContains` is required. Matching is literal substring matching,
with no regular expressions. Forbidden matches are reported by **line number only**, so a secret
in the file is not copied into the report. A missing file is FAIL. A file larger than 5 MB is ERROR.

Typical uses: placeholder text removed (`"Lorem ipsum"`), no leftover `debugger` statements,
a required config key present in `.env.example`, no live key prefixes (`"sk_live_"`) committed.

## `http`

| Field          | Type                   | Default | Description                                   |
| -------------- | ---------------------- | ------- | --------------------------------------------- |
| `url`          | string                 | -       | Required. `http://` or `https://` URL.        |
| `method`       | `"GET"` \| `"HEAD"`    | `GET`   | Only safe, read-only methods are supported.   |
| `expectStatus` | integer or array       | 2xx     | Accepted status code(s), e.g. `200` or `[200, 204]`. |
| `bodyContains` | string                 | -       | Literal text the body must contain (GET only). |
| `timeoutMs`    | integer                | `5000`  | Covers connecting and reading the body.       |

Redirects are followed and the final URL is recorded. Up to 1 MB of the body is read; a
300-character redacted snippet is kept as evidence. Connection refused, DNS failure and timeout
are all **FAIL**, because the claim "the service is running" is false in each case.

ProofDone never starts your server. Start it first, or mark the check `"required": false`.

## `docker`

| Field       | Type                                   | Default   | Description               |
| ----------- | -------------------------------------- | --------- | ------------------------- |
| `container` | string                                 | -         | Required. Container name or id. |
| `expect`    | `"exists"` \| `"running"` \| `"healthy"` | `running` | What must be true.        |
| `timeoutMs` | integer                                | `15000`   |                           |

Runs `docker inspect --type container`.

| Situation                                      | Status      |
| ---------------------------------------------- | ----------- |
| Docker CLI not installed / daemon unreachable  | NOT CHECKED |
| Container not found                            | FAIL        |
| Not running (for `running` / `healthy`)        | FAIL        |
| `healthy` expected, container has no HEALTHCHECK | NOT CHECKED |
| Health `starting` or `unhealthy`               | FAIL        |
| Unexpected docker error                        | ERROR       |
