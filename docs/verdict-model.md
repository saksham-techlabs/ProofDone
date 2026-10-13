# Verdict model

## Check statuses

| Status        | Meaning                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------- |
| `PASS`        | ProofDone inspected the project and the claim holds.                                     |
| `FAIL`        | ProofDone inspected the project and the claim does not hold.                             |
| `WARNING`     | The claim holds, with a caveat worth reading (untracked files that are allowed, a letter-case mismatch). |
| `NOT_CHECKED` | ProofDone could not inspect the thing (tool missing, daemon down, no upstream). No conclusion either way. |
| `ERROR`       | The check itself could not run correctly (bad working directory, unexpected tool output, file too large). |

The guiding rule: **missing access is never converted into PASS.** A check that cannot see what
it needs reports `NOT_CHECKED` (or `ERROR`) and says why.

## Verdict

Only **required** checks (`"required": true`, the default) influence the verdict. Rules are
evaluated in order and the first match wins:

| # | Condition                                          | Verdict      | Exit code |
| - | -------------------------------------------------- | ------------ | --------- |
| 1 | Any required check is `FAIL` or `ERROR`            | `NOT_DONE`   | 1         |
| 2 | Any required check is `NOT_CHECKED`                | `UNVERIFIED` | 3         |
| 3 | `--strict` and any required check is `WARNING`     | `NOT_DONE`   | 1         |
| 4 | Otherwise                                          | `DONE`       | 0         |

Consequences:

- A failure outranks an unverifiable check: if anything required failed, the work is not done,
  whatever else could not be checked.
- `UNVERIFIED` is deliberately not `DONE`. If you consider a check optional, mark it
  `"required": false` instead of relying on it being skipped.
- Optional checks are always run and reported. When the verdict is `DONE`, the reason mentions
  how many optional checks did not pass.
- `--only` restricts the run, and the verdict covers only the checks that ran. The report
  includes an `only` field so a partial run cannot be mistaken for a full one.

## Exit codes

| Code | Meaning                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| 0    | `DONE`                                                                           |
| 1    | `NOT_DONE`                                                                       |
| 2    | ProofDone could not run verification: usage error, missing/invalid config, or an internal error. With `--json`, an error document is printed. |
| 3    | `UNVERIFIED`                                                                     |
| 130/143 | Interrupted by SIGINT/SIGTERM. Running commands are terminated.               |
