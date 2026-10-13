# Example: Node.js API

A tiny, dependency-free HTTP API (`src/server.js`) with a `/health` endpoint and tests that use
`node --test`. Its [`proofdone.config.json`](proofdone.config.json) checks the claims an agent
typically makes after working on an API:

| Check                  | Type           | Claim being verified                          |
| ---------------------- | -------------- | --------------------------------------------- |
| Tests                  | `command`      | "All tests pass"                              |
| Required files         | `files`        | "`.env.example` is documented and `.env` is not committed" |
| No debug leftovers     | `file-content` | "I cleaned up `debugger` / TODO / FIXME"      |
| HTTP health endpoint   | `http`         | "The service is running and healthy"          |
| Git working tree       | `git-clean`    | "Everything is committed"                     |
| Docker health          | `docker`       | Optional: "The container is healthy"          |

## Try it

From this directory, with ProofDone built (`npm run build` in the repository root):

```bash
# 1. Without the server running: the HTTP check fails (connection refused).
node ../../dist/cli/main.js verify

# 2. Start the API in another terminal, then verify again.
npm start
node ../../dist/cli/main.js verify
```

The `git-clean` check looks at the git repository that contains this directory (the ProofDone
repository, when run from a checkout).

## Sample output

Captured from real runs of this example on Windows with Node.js 24 and without Docker installed.
Only the project path was shortened to `<repo>`. Timings will differ on your machine.

With the server running:

```text
ProofDone Verification
Project: <repo>/examples/node-api
Config:  proofdone.config.json

  Tests                     PASS         exit 0 in 1.2s
  Required files            PASS         all 5 path rule(s) satisfied
  No debug leftovers        PASS         src/server.js: 3 forbidden text(s) absent
  HTTP health endpoint      PASS         200 in 80ms
  Git working tree          PASS         working tree clean on main
  Docker health (optional)  NOT CHECKED  Docker CLI not found on PATH

5 passed, 0 failed, 0 warnings, 1 not checked, 0 errors (6 checks in 1.3s)

Final verdict: DONE
Reason: All 5 required checks passed (1 optional check did not pass).
```

Exit code `0`. Docker is optional here, so its NOT CHECKED status is reported but does not
block the verdict. If it were required, the verdict would be UNVERIFIED (exit code `3`).

With the server stopped:

```text
  HTTP health endpoint      FAIL         request failed: connection refused (is the server running?)
  ...
Final verdict: NOT DONE
Reason: Required check failed: HTTP health endpoint (request failed: connection refused (is the server running?)).
```

Exit code `1`.
