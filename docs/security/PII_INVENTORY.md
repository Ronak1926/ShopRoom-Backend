# Personal data inventory and retention policy

Last reviewed: 2026-10-30. Update this file in the same change that adds or alters stored personal data.

| Data | Subject | Where | Why | Retention | Deleted by |
| --- | --- | --- | --- | --- | --- |
| Email | Customer, shopkeeper | `Customer.email`, `Shopkeeper.email`, `ShopkeeperDraft.email`, `EmailOtp.email` | Sign-in, verification | Life of the account; OTP rows 1 day past expiry; abandoned drafts 7 days | Account deletion; `dataRetention.service.ts`; `cleanupExpiredDrafts` |
| Password hash (bcrypt, cost 12) | Customer, shopkeeper | `passwordHash` | Sign-in | Life of the account | Account deletion |
| Full name | Customer | `Customer.fullName` (also shown to the room) | Display in rooms and chat | Life of the account | Account deletion |
| Owner name, shop name, address, city, state, pincode | Shopkeeper | `Shopkeeper`, `Shop` | Shop profile shown to customers | Life of the account | Account deletion |
| Phone number | Shopkeeper | `Shopkeeper.phoneNumber`, `Shop.phoneNumber`, draft `data` | Verified contact, shown on the shop profile | Life of the account | Account deletion |
| Customer position (lat/lng) | Customer | `Customer.latitude/longitude/locationUpdatedAt` | Room discovery and "nearby" notifications; only with `allowLocationAccess` | Erased when consent is withdrawn, and 30 days after the last report | Consent withdrawal; retention job; account deletion |
| Shop position (lat/lng) | Shopkeeper | `Shop.latitude/longitude` | Distance to customers | Life of the account | Account deletion |
| Chat messages | Both | `Message.text` (AES-256-GCM at rest) | Room chat | Until deleted by the sender, or the account/room is deleted | Account deletion (cascade) |
| Push device token, user agent | Customer | `CustomerDevice` | Deliver push | Until sign-out/disable, 270 days without activity, or FCM reports it dead | Sign-out; retention job; account deletion |
| Per-device delivery record (delivered/opened/clicked times, receipt token) | Customer | `NotificationSendRecipient` | Notification analytics | 180 days (the send keeps its aggregate counters) | Retention job; account deletion |
| Razorpay order and payment ids | Shopkeeper | `Shopkeeper.razorpay*`, `PlanPayment` (plan, amount, ids; one row per sign-up or renewal) | Reconcile payments, prevent reuse, show billing history | Life of the account (finance may require longer; keep the ids, not card data) | Account deletion |
| GST invoice (a frozen snapshot: the shop's name and address, the buyer's optional GSTIN, amounts, invoice number) and the optional GSTIN a shopkeeper saves | Shopkeeper | `PlanPayment.invoiceSnapshot`, `Shopkeeper.gstin` | Issue the tax invoice the business must keep | While the account exists, and longer where the law requires keeping tax records | Account deletion removes the payment rows, but a copy of every issued invoice's snapshot is first written to `InvoiceArchive` (no link to the account) because it is a tax record. Decide the retention period with your accountant and purge `InvoiceArchive` accordingly (there is no automatic purge) |
| Payment order (plan, amount in paise, Razorpay order and payment ids, status, the id of the sign-up draft it paid for) | Shopkeeper | `PaymentOrder` | Decide what a payment buys, make webhooks and confirmations idempotent, refund payments that cannot be honoured | Granted orders: life of the account. Unpaid orders: 90 days | Account deletion (cascade); retention job |
| Security activity (event type, account id, client IP, browser string, small non-secret detail such as the sign-in method; never passwords, tokens, codes or email addresses) | Customer, shopkeeper | `SecurityEvent` | Show the owner their recent sign-ins and account changes; investigate incidents | 365 days | Account deletion (explicit delete); retention job |
| Two-step verification (the authenticator secret, encrypted at rest; SHA-256 hashes of one-time recovery codes) | Customer, shopkeeper who turned it on | `MfaCredential`, `MfaRecoveryCode` | Ask for a second factor at sign-in | Until they turn it off or delete the account | Turn-off; account deletion |
| Password-reset token (SHA-256 hash only, never the token) | Customer, shopkeeper | `PasswordResetToken` | One-time password reset link | Valid 30 minutes; rows removed by the retention job 1 day after they expire | Retention job; account deletion |
| Newsletter email | Public site visitor (may not have an account) | `NewsletterSubscriber.email` | Product updates the person asked for | Until they unsubscribe (signed link in the welcome email, `/unsubscribe` page) or ask to be removed | `POST /api/public/newsletter/unsubscribe` deletes the row |
| Contact-form message (name, email, subject, text) | Public site visitor | Not stored: relayed by email to `CONTACT_EMAIL` and kept only in that mailbox | Answer the enquiry | Per the support mailbox policy | Delete from the mailbox |
| Notification preferences (quiet hours, weekend sending, expiry, studio defaults) | Shopkeeper | `NotificationPreference.settings` | Enforced on scheduled sends; studio defaults | Life of the account | Account deletion |
| Notification designs, assets, send history | Shopkeeper | `NotificationDesign*`, `NotificationAsset`, `NotificationSend`, Cloudinary | The product | Life of the account | Account deletion (database and Cloudinary) |

Card numbers and UPI details never reach ShopRoom; Razorpay Checkout handles them.

## Processors

Twilio (phone OTP), Razorpay (payments), Firebase/Google (sign-in, push), Cloudinary (images), SMTP provider (email OTP, password reset, payment receipts, the newsletter welcome email and contact messages), Pexels/Unsplash (stock-image search; queries only).

## Data-subject requests

- **Erasure**: `DELETE /api/customers/me` and `DELETE /api/shopkeeper/me` (password, or a fresh Google sign-in for Google-only customers). Everything above is removed in one transaction; Cloudinary images are deleted best-effort afterwards.
- **Withdraw location consent**: `PATCH /api/customers/me { allowLocationAccess: false }` erases the stored position immediately.
- **Sign out everywhere**: `POST /api/customers/me/logout-all`, `POST /api/shopkeeper/logout-all`.
- **Access/export**: `POST /api/customers/me/export` and `POST /api/shopkeeper/me/export` (profile page, "Download my data"; password or a fresh Google sign-in again; 5 per hour per account; `Cache-Control: no-store`). The file leaves out credentials (password hash, session counter, Firebase uid), push tokens, delivery receipt tokens, and, for a shopkeeper, the members' names and emails. Lists are capped (20,000 messages, 5,000 of anything else) and the file says which were cut. Source: `dataExport.service.ts`; add a new table there when it starts holding personal data.
- **Newsletter opt-out**: the unsubscribe link in the welcome email (an HMAC of the address, no expiry, in the URL fragment so it stays out of logs). Only a new address is mailed.
- **Payment receipts**: one email per fulfilled `PaymentOrder` (`receiptSentAt`), to the shopkeeper's address; retried by the daily job for 7 days. It contains the shop name, plan, amount, date and Razorpay ids, nothing else.

## Logs

Logs must not contain passwords, tokens, OTP codes, email addresses or full phone numbers. Audited 2026-10-30: customer ids and OTP codes were removed from logs and phone numbers are masked (`+91••••••3210`). Prisma errors are logged by message only.
