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

OUTPUT_PLACEHOLDER
