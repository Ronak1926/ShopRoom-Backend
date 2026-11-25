# Environments, deployment and rollback

## What exists in the repositories, and what does not

| Piece | State |
| --- | --- |
| CI on every push and pull request (typecheck, tests against Postgres, build; lint ratchet and build for the web app) | Done, workflows in `.github/workflows/ci.yml` |
| Dependency audit and committed-secret scan | Done, `security.yml` |
| Pull-request templates, pre-commit hooks | Done |
| API container image (`Dockerfile`) and deploy workflow (`deploy.yml`) | **Written, not run.** The Docker engine was not running where this was authored and GitHub Actions cannot be run locally. The YAML parses; the first real run will be the first test. The compiled build itself (`node dist/index.js`) was started and probed successfully. |
| Staging environment, deploy hooks, GitHub environments, branch protection | **Not created.** They need accounts and permissions the repository does not have. Steps below. |

## Environments

| | Local | Staging | Production |
| --- | --- | --- | --- |
| Database | developer's Postgres | **its own database**, never shared with production | production database with backups |
| `NODE_ENV` | development | `production` (so the same fail-closed checks run) | `production` |
| Firebase | dev project or emulator | **separate Firebase project** and service account | production project |
| Razorpay | test keys or mock | **test-mode keys** and a test webhook secret | live keys |
| Twilio | mock (accepts any code) | a test Verify service | production Verify service |
| `CORS_ORIGINS` | open in development | the staging web origin only | the production web origin only |
| Other | | `METRICS_TOKEN`, `ALERT_WEBHOOK_URL` pointing at a non-paging channel | both pointing at the on-call channel |

Rules that keep staging useful: staging data is synthetic (never a copy of production personal data), staging secrets are never reused in production, and a staging deploy of every change precedes its production deploy.

Checklist to create staging (all manual):
1. Provision a Postgres database and a hosting service for the API image; set the variables listed in `docs/security/SECRET_ROTATION.md` with staging values. `NODE_ENV=production` makes the API refuse to boot until they are all present.
2. Create the Firebase staging project, a service account, and a web app; point a staging deployment of the web app at the staging API (`NEXT_PUBLIC_API_BASE_URL`) and staging Firebase config.
3. In Razorpay test mode, create a webhook to `https://<staging-api>/api/shopkeeper/payment/webhook` and copy its secret.
4. Run migrations (below), then seed a demo shop for smoke testing.
5. Point an uptime monitor at `https://<staging-api>/readyz`.

## Release flow

```
pull request ──CI + review──▶ merge to development ──▶ image built (tag = commit SHA)
                                                     └▶ staging deployed automatically
staging smoke test ──▶ run "deploy" workflow: environment=production, tag=<SHA>
                       └▶ waits for a required reviewer ──▶ production deployed
```

- The same image (same SHA) that ran on staging is the one promoted; nothing is rebuilt for production.
- The web app is deployed by its hosting platform's Git integration (preview per pull request, production from the release branch). Use the same two-step habit: verify the preview/staging build, then promote.
- GitHub setup for the gate: Settings → Environments → create `staging` and `production`; on `production` add **Required reviewers**; add a secret `DEPLOY_HOOK_URL` to each environment (the hosting platform's deploy hook URL; the workflow POSTs `{"image":"ghcr.io/…:<sha>"}` to it, so adapt the body if your platform expects something else).

### Database migrations

Run once per release, before the new version takes traffic, as an explicit step (a pre-deploy command on the platform, or): `pnpm exec prisma migrate deploy` with the target `DATABASE_URL`.

- Write migrations so the **previous release still works after them** (add columns/tables/indexes; do destructive changes in a later release). That makes rollback a pure redeploy.
- Take a dump before any migration that rewrites or deletes data: `pg_dump --format=custom --file pre-<release>.dump "$DATABASE_URL"`.

## Rollback

1. Decide fast: if the release is the likely cause, roll back first and investigate afterwards.
2. Actions → **deploy** → *Run workflow* → environment, and the **commit SHA of the previous good release** (find it in the deploy history, or `git log` on the release branch). Approve if production.
3. If the bad release shipped a migration, check that the previous code still works with it (see above). Only if it does not, restore from the pre-migration dump (see `RUNBOOK.md`).
4. Verify: `/readyz`, a sign-in, and the dashboard of the 5xx alert clearing.
5. For the web app, use the hosting platform's "redeploy previous build".

**Rollback has not been rehearsed.** Rehearse it once on staging as soon as the pipeline exists (deploy release N, deploy N+1, roll back to N through the workflow) and record it in the drill log in `RUNBOOK.md`.

## Branch protection (needs repository admin)

The default branch of both repositories is `master`; the workflows also cover `main`. In each repository: Settings → Branches → add a rule for the default branch with

- Require a pull request before merging (at least 1 approval)
- Require status checks to pass: backend `test`, `audit`, `secrets`; web app `build`, `audit`, `secrets` (the check names appear after the workflows have run once)
- Require branches to be up to date before merging
- Do not allow bypassing the above; block force pushes and deletions

Equivalent with the GitHub CLI (replace the repository and branch):

```sh
gh api -X PUT repos/<owner>/<repo>/branches/<branch>/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["test", "audit", "secrets"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null
}
JSON
```

This has deliberately not been applied from here: it changes who can push to your repositories, so it is a decision for the repository owner.

## Local checks that mirror CI

- Backend: `pnpm typecheck && pnpm test && pnpm build` (needs `pnpm test:db:setup` once).
- Web app: `pnpm exec tsc --noEmit && pnpm lint:ratchet && pnpm build`.
- Hooks: `pnpm install` points git at `.githooks/`; the pre-commit hook type-checks (and runs the lint ratchet on staged files in the web app). `git commit --no-verify` skips it; CI does not.
