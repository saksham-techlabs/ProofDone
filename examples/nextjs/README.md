# Example: Next.js app

This is a **config-only example**: copy [`proofdone.config.json`](proofdone.config.json) into the
root of a Next.js (App Router) project and adjust the paths, scripts and branch name. It assumes:

- `package.json` scripts `lint`, `build` and `test`, plus TypeScript (`npx tsc --noEmit`)
- a health route at `app/api/health/route.ts`, for example:

  ```ts
  export function GET() {
    return Response.json({ status: 'ok' });
  }
  ```

- a `.env.example` documenting `DATABASE_URL` and `NEXTAUTH_SECRET`

## What it verifies

| Check                               | Type           | Notes                                                |
| ----------------------------------- | -------------- | ---------------------------------------------------- |
| Typecheck, Lint, Build, Tests       | `command`      | Build gets a 15-minute timeout                        |
| Required files                      | `files`        | `.env` and `.env.local` must **not** exist in the repo |
| Env example documents required keys | `file-content` | Required keys present, no live-looking secrets       |
| Placeholder copy removed            | `file-content` | No "Lorem ipsum" or create-next-app starter text     |
| HTTP health endpoint                | `http`         | Requires `npm run dev` or `npm start` to be running  |
| Feature branch                      | `git-branch`   | Optional                                             |
| Git working tree                    | `git-clean`    |                                                      |
| Pushed to remote                    | `git-upstream` | Optional; uses the last fetched remote state         |

## Sample output

> **Illustrative output.** It shows a typical run after an agent reported "the billing page is
> done", with the dev server running. Timings and file names are examples.

```text
ProofDone Verification
Project: /home/dev/acme-web
Config:  proofdone.config.json

  Typecheck                            PASS         exit 0 in 6.8s
  Lint                                 PASS         exit 0 in 4.1s
  Build                                PASS         exit 0 in 48.2s
  Tests                                PASS         exit 0 in 9.5s
  Required files                       PASS         all 7 path rule(s) satisfied
  Env example documents required keys  PASS         .env.example: 2 required text(s) found, 2 forbidden text(s) absent
  Placeholder copy removed             FAIL         app/page.tsx: 1 forbidden text(s) present
  HTTP health endpoint                 PASS         200 in 31ms
  Feature branch (optional)            PASS         on branch feature/billing
  Git working tree                     PASS         working tree clean on feature/billing
  Pushed to remote (optional)          FAIL         2 commit(s) not pushed (origin/feature/billing)

Evidence
  FAIL  Placeholder copy removed
      forbidden text "Get started by editing" found on line(s) 12
  FAIL  Pushed to remote (optional)
      feature/billing vs origin/feature/billing: ahead 2, behind 0
      Compared against the local remote-tracking ref; ProofDone does not run `git fetch`.

9 passed, 2 failed, 0 warnings, 0 not checked, 0 errors (11 checks in 1m 9s)

Final verdict: NOT DONE
Reason: Required check failed: Placeholder copy removed (app/page.tsx: 1 forbidden text(s) present).
```

The optional "Pushed to remote" failure is shown but does not affect the verdict. The
create-next-app starter text left in `app/page.tsx` does.
