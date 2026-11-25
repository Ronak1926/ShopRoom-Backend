## What changed
<!-- One or two sentences on the behaviour change, not the diff. Link the Jira ticket (SCRUM-nn). -->

## How it was tested
<!-- Tests added or run, and anything checked by hand. "Not tested" is an acceptable answer if you say why. -->

## Deployment notes
- [ ] No database migration
- [ ] Migration included (name: ______) and it is safe to leave in place if this release is rolled back
- [ ] No new or changed environment variables
- [ ] New or changed environment variables (list them, and update `docs/security/SECRET_ROTATION.md` if secret): ______
- [ ] No change to API request/response shapes the web app depends on
- [ ] Coordinated front-end change needed (link PR): ______

## Security checklist
- [ ] New routes are authenticated, or added to the public allow-list in `security.http.integration.test.ts` with a reason
- [ ] Queries are scoped to the authenticated user; no client-supplied ids trusted
- [ ] Input validated with Zod at the controller boundary
- [ ] No secrets, tokens or personal data logged or returned
