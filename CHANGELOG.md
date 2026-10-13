# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Reject empty file rule sets; detect multiline forbidden text with normalized line endings.
- Reject symlink/junction escapes and dangling links instead of reporting misleading file results.
- Reject truncated Git evidence and malformed Docker state; protect Docker operands from option parsing.
- Disable Git fsmonitor hooks and include submodule dirtiness despite ignore settings.
- Ignore inherited Git repository/index selectors so checks inspect the selected project.
- Sanitize terminal controls and redact recognized secrets consistently in verification reports.
- Report incomplete HTTP body evidence as NOT_CHECKED and enforce the 1 MiB read limit.
- Clarify warning/optional-only verdict reasons, command permissions and cleanup limitations.

### Added

- Release regression coverage and a package smoke test on every OS/Node CI matrix entry.
- Ship referenced documentation and examples in the npm artifact.

## [0.1.0] - Unreleased

Initial version (not yet published to npm).

### Added

- `proofdone verify` with text and `--json` output, `--only`, `--strict`, `--quiet` and `--no-color`.
- `proofdone init`: builds a starter config from the project (package.json scripts, key files,
  git). Refuses to overwrite without `--force`.
- `proofdone validate`: validates the config and lists the commands `verify` would run, without
  executing anything.
- Check types: `command`, `git-repo`, `git-clean`, `git-branch`, `git-upstream`, `files`,
  `file-content`, `http`, `docker`.
- Statuses `PASS`, `FAIL`, `WARNING`, `NOT_CHECKED`, `ERROR`; verdicts `DONE`, `NOT_DONE`,
  `UNVERIFIED`; exit codes 0 / 1 / 2 / 3.
- Config validation with path-precise error messages and rejection of unknown fields.
- JSON Schema for editor completion (`schema/proofdone.schema.json`).
- Process-tree termination on timeout, closed stdin for commands, output tail capture with
  best-effort secret redaction.
- Case-exact path checks that flag names that only match on case-insensitive file systems.
