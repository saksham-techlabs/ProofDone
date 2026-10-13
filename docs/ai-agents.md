# Using ProofDone with AI coding agents

ProofDone does not integrate with any particular agent. It is a CLI with a stable exit code and
JSON output, so any agent that can run a terminal command can use it, and you can check any
agent's claims after the fact.

## Pattern 1: you verify the claim

The agent says it is done. You run:

```bash
proofdone verify
```

If the verdict is not `DONE`, paste the evidence section back to the agent. It is concrete
("exit 2: error TS2322 in src/app.ts", "untracked: src/users.test.ts"), which makes the follow-up
precise.

## Pattern 2: the agent verifies before reporting

Add a rule to your agent instructions (`AGENTS.md`, `.cursor/rules/*.mdc`, `CLAUDE.md`, a Codex
prompt, ...):

```markdown
## Definition of done

Before saying a task is complete:

1. Run `npx proofdone verify --json`.
2. If `verdict` is `"DONE"`, you may report completion and quote the `reason`.
3. If `verdict` is `"NOT_DONE"`, fix the failing checks and run it again.
4. If `verdict` is `"UNVERIFIED"`, say which checks could not be verified and why.
   Do not claim those things are true.
5. Never edit `proofdone.config.json` to make verification pass unless the user asked you to.
```

The last rule matters: an agent that rewrites the config can make any project "pass". Review
changes to `proofdone.config.json` the way you would review changes to CI configuration.

## Pattern 3: CI as the final word

Run `proofdone verify` in CI (see the README) so that the verdict comes from a clean machine,
not from the agent's environment.

## Reading the JSON report

The fields that matter most:

- `verdict`: `DONE`, `NOT_DONE` or `UNVERIFIED`
- `reason`: one sentence explaining the verdict
- `checks[].status` and `checks[].summary`: per-check result
- `checks[].details`: the evidence lines (output tail, file lists, line numbers)
- `exitCode`: the same value the process exits with
