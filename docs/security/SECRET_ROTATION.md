# Secret inventory and rotation

History check (2026-10-30): both repositories were scanned across every commit for committed `.env` files and secret-shaped strings (private keys, `AIza…`, `AC…` Twilio SIDs, `rzp_live_`, `sk_live_`, `ghp_`). Nothing was found, so no secret needs rotating *because of* the repository. Rotation below is routine hygiene and must still be performed by whoever holds the provider accounts before launch.

The server refuses to start with `NODE_ENV=production` unless the secrets marked **required** are present (`src/config/env.ts`).

| Secret | Required | Where to rotate | Notes |
| --- | --- | --- | --- |
| `JWT_SECRET` (≥ 32 chars) | yes | `openssl rand -base64 48` | Zero-downtime: set `JWT_SECRET` to the new value and `JWT_SECRET_PREVIOUS` to the old; deploy; after 7 days remove `JWT_SECRET_PREVIOUS`. Before rotating, copy the current value into `MESSAGE_ENCRYPTION_KEY`, otherwise stored chat history can no longer be decrypted. |
| `MESSAGE_ENCRYPTION_KEY` | no | same | Keep stable once set; changing it makes existing messages unreadable. |
| `DATABASE_URL` | yes | database provider | Use a least-privilege role (no superuser, no DDL at runtime) and TLS. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | yes | Razorpay dashboard → API keys | Live keys only in production. |
| `RAZORPAY_WEBHOOK_SECRET` | yes | Razorpay dashboard → Webhooks | Webhooks are rejected while unset. |
| `TWILIO_ACCOUNT_SID` / `AUTH_TOKEN` / `VERIFY_SERVICE_SID` | yes | Twilio console | Prefer an API key over the account auth token. |
| `FIREBASE_PROJECT_ID` / `CLIENT_EMAIL` / `PRIVATE_KEY` | yes | Google Cloud → service account → keys | Create a new key, deploy, then delete the old key. |
| `CLOUDINARY_*` | for uploads | Cloudinary console | |
| `SMTP_*` | for email OTP | mail provider | Use an app password, not the account password. |
| `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY` | optional | provider | |
| `CORS_ORIGINS` | yes | n/a | Comma-separated front-end origins; no wildcard. |
| `TRUST_PROXY_HOPS` | behind a proxy | n/a | Set to the number of proxies in front of the API so client IPs (and rate limits) are correct. |

Incident response: bump `tokenVersion` for affected accounts (or all of them) to sign every session out immediately, rotate the secret, and review logs.

Front end: only `NEXT_PUBLIC_*` values (public by design: Firebase web config, VAPID public key, Razorpay key id) are used. Never put a private key in a `NEXT_PUBLIC_*` variable.
