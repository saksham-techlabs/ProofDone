# Security policy

## Supported versions

ProofDone is pre-1.0. Security fixes are made on the latest released version only.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately using the
repository's GitHub private vulnerability reporting ("Security" tab, then "Report a vulnerability")
once the public repository exists and the maintainer has enabled it. There is no public reporting
endpoint yet. Enabling private vulnerability reporting is a repository-creation checklist item.
Include steps to reproduce, the affected version, and the impact you expect.

You can expect an acknowledgement within a few days. Once a fix is available, we will publish an
advisory and credit you if you wish.

## Threat model

ProofDone is a local verification tool. Understanding what it trusts helps you use it safely.

**The config file is trusted input.** `command` checks run the configured shell commands with
the permissions of the user running ProofDone. A malicious `proofdone.config.json` can run
arbitrary code, in the same way a malicious `package.json` script or Makefile can.

- Review `proofdone.config.json` before running `proofdone verify` in a repository you did not
  write. `proofdone validate` lists every command without executing anything.
- In CI, treat changes to `proofdone.config.json` like changes to workflow files.
- Do not let an AI agent change the config to make verification pass without reviewing it.

**What ProofDone does to limit risk:**

- Paths inside the config must be relative and resolve inside the config directory, including
  symlink/junction targets. This is not a sandbox against concurrent filesystem changes.
  CLI location options accept absolute paths; `init --force` can overwrite a config symlink's target.
- `http` checks issue `GET`/`HEAD` requests, follow redirects, and can reach private network services.
  These methods do not guarantee that a server has no side effects. Docker contexts may be remote.
- Git is invoked read-only (`GIT_OPTIONAL_LOCKS=0`, no fetch, no prompts).
- Command output is truncated and passed through best-effort secret redaction (common token
  formats and `env` values of eight or more characters from the config). `file-content` never
  echoes matching lines, but reports configured search text. HTTP reports contain body snippets.
- Commands inherit the parent environment. Trust PATH, installed executables, Git configuration
  and Docker context. The Git fsmonitor hook is disabled for verification.
- Commands run with stdin closed and a timeout. Process-tree termination is best effort;
  detached descendants and OS-level termination failures are not contained.

**Out of scope:** commands you configure doing harmful things, and secrets in output that do not
match a known pattern. Redaction is a safety net, not a guarantee. Avoid printing secrets in
build or test output.
