# Disaster-recovery and incident runbook

For whoever is on call. Start with **First five minutes**, then jump to the section that matches. Commands assume a shell on a machine that can reach production; adapt names to your host.

## First five minutes

1. Confirm the symptom yourself: `curl -si https://<api-host>/readyz` (200 `{"database":"up"}` is healthy; 503 means the database; no answer means the process or the network).
2. Find a failing example. The web app and API return `X-Request-Id`; search logs for that id to see every line of that request.
3. Check what changed: the latest deploy, a secret rotation, a provider status page (Razorpay, Twilio, Firebase, Cloudinary, your database host).
4. If a deploy is the likely cause, **roll back first, investigate second** (see below).
5. Say what you know in the team channel, even if it is "investigating".

## The database is unreachable

Symptoms: `/readyz` 503, `Readiness check failed` warnings, many 500s, `elevated_5xx` alert.

1. Check the provider's status page and connection count; restart the pooler or the database if it is yours.
2. Verify the credentials and `DATABASE_URL` weren't rotated or expired.
3. The API stays up and answers 503 on `/readyz`; users see errors until the database is back. There is no cache to fall back on, so recovery is restoring the database.
4. **If data is lost or corrupt**, restore from the most recent backup (below). Stop writes first (scale the API to zero or put up a maintenance page) so nothing is written to a database you are about to replace.

### Restoring from backup

Backups: enable the provider's automated daily backups with point-in-time recovery and at least 7 days of retention; take a manual dump before every risky migration (`pg_dump --format=custom --file pre-migration.dump "$DATABASE_URL"`).

1. Create a new database from the backup (provider console), or restore a dump: `pg_restore --no-owner --dbname "$NEW_DATABASE_URL" backup.dump`.
2. Point a staging copy of the API at it and check it: compare row counts with the source where you still have it, sign in, open a room, send a test notification.
3. Switch production's `DATABASE_URL` to the restored database and restart the API.
4. Reconcile the gap: anything written after the backup is lost. Payments in that window exist at Razorpay; compare its dashboard with `Shopkeeper.razorpayPaymentId` and contact affected shopkeepers.

**Rehearsal:** `pnpm db:verify-backup` dumps the configured database, restores it into a scratch database, compares every table's row count, and cleans up. It was run on 2026-11-02 against the development database (22 tables, 7,051 rows identical). That proves the procedure and the tooling, not your provider's automated backups: schedule a quarterly drill that restores a *provider* backup into a new instance and runs the same comparison, and record the date and result in the table at the bottom.

## FCM push is down or failing

Symptoms: `send_failure_spike` alert, `PushDeliveryFailing`, sends marked `FAILED` with `ALL_DELIVERIES_FAILED`, 502 "We couldn't reach the push service".

1. Check the Firebase status page. If FCM is degraded, nothing to fix on our side; sends fail cleanly and are recorded.
2. If only we fail: check `FIREBASE_*` credentials (service account key deleted or rotated?) and logs for `FCM batch failed`.
3. Dead tokens are removed automatically; a high `fcm_tokens_invalidated_total` after a long quiet period is normal.
4. After recovery, scheduled sends that were due during the outage were either sent late (within an hour) or recorded as `MISSED_WINDOW`; shopkeepers can resend manually. Do not bulk re-send automatically; old promotions may no longer be valid.

## Razorpay is down or payments fail

How payments work and every situation they handle: `docs/ops/PAYMENTS.md`.

Symptoms: `payment_failures`, `webhook_signature_failures` or `refund_failed` alert; shopkeepers cannot finish sign-up or renewal.

1. Razorpay status page. During an outage nobody can pay (the API answers "The payment service is unavailable"), but nothing is lost: drafts are kept for 7 days, and a payment that completes at Razorpay is finished by the webhook even if the buyer's browser never reports back.
2. Webhook signature failures: confirm `RAZORPAY_WEBHOOK_SECRET` matches the dashboard webhook (a rotated or mixed-up secret is the usual cause; it is not the API key secret). With the right secret, failures mean someone is sending forged webhooks: they are already rejected; leave it.
3. "This payment does not belong to…" or a webhook "does not match the order": the payment is not what we created the order for. Look it up in the dashboard before doing anything; never create an account by hand without a captured payment.
4. A buyer says they paid but have no account or plan: look for the payment in the dashboard, then `SELECT * FROM "PaymentOrder" WHERE "razorpayPaymentId" = '<pay_…>'`. `FULFILLED` means it was granted (they should log in with the email and password they chose); `REFUNDED` means it was returned; `CREATED` means the webhook has not arrived: check the webhook's delivery log in the Razorpay dashboard and redeliver it from there (safe to repeat).
5. `NEEDS_REFUND` orders (alert `refund_failed`): the payment could not be granted and the automatic refund did not go through. It is retried on every webhook redelivery and daily. If it persists, refund the payment by hand in the dashboard; the system then marks it `REFUNDED` itself.

## Twilio (phone OTP) is down

Shopkeeper sign-up cannot verify phone numbers; the API answers "Phone verification is temporarily unavailable" or a Twilio message. Check Twilio status and the Verify service SID. Do **not** disable verification to unblock users: development mode accepts any code, and production refuses to run without Twilio configured for exactly that reason.

## Email OTP is not arriving

Check `OTP send error` entries (SMTP credentials, provider limits). Customers can still use Google sign-in. Codes expire after 10 minutes; resends are limited to one per minute.

## Elevated 5xx or a bad deploy

1. Look at `Unhandled error` entries and the error tracker for the first occurrence and the deploy time.
2. **Roll back** to the previous release (redeploy the last good image/commit). If the bad release shipped a migration, check whether the previous code still works with it before rolling back (most migrations here only add columns, tables and indexes and are safe to leave in place); restore from the pre-migration dump only as a last resort.
3. Front-end only problems (`FrontEndErrorSpike`, blank pages): roll back the web deploy; the API is independent.
4. After rollback, write down the cause and add a test.

## Scheduled sends did not fire

1. The scheduler runs inside the API process every 30 s; it is down whenever the API is. Check `/readyz` and the logs for `Scheduler tick failed`.
2. Occurrences more than an hour late are recorded as `MISSED_WINDOW` rather than sent, and the series continues from now. `scheduler_runs_total{result="missed"}` shows how many.
3. Sends stuck `PENDING` for 15 minutes are failed automatically by the same loop.
4. Several API instances are safe: each claims due schedules with row locks, so nothing fires twice.

## API is down

1. Process crashed: look for `Uncaught exception` just before the last log line; the supervisor should restart it. A crash loop is usually a bad config: production refuses to start with missing or weak secrets and names the setting in the error.
2. Port or network: `curl -si http://localhost:$PORT/healthz` on the host.
3. Out of memory: `process_resident_memory_bytes` trend; restart and investigate leaks.

## Suspected security incident

1. Contain: bump `tokenVersion` for the affected account(s) (or all) to sign every session out; the change takes effect within 15 seconds across instances.
2. Rotate the exposed secret (`docs/security/SECRET_ROTATION.md`; `JWT_SECRET_PREVIOUS` allows a rotation without logging everyone out, but skip it if the old secret is compromised).
3. Preserve logs, review by `requestId`, and follow your legal obligations for personal-data breaches (see `docs/security/PII_INVENTORY.md` for what is stored).

## Drill log

| Date | Scenario | Result | Follow-ups |
| --- | --- | --- | --- |
| 2026-11-02 | `pnpm db:verify-backup` against development DB (dump, restore to scratch DB, row-count compare) | Passed: 22 tables, 7,051 rows identical, scratch DB dropped | Run against a provider backup before launch |
