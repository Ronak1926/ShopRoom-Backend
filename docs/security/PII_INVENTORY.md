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
| Razorpay order and payment ids | Shopkeeper | `Shopkeeper.razorpay*` | Reconcile payments, prevent reuse | Life of the account (finance may require longer; keep the ids, not card data) | Account deletion |
| Notification designs, assets, send history | Shopkeeper | `NotificationDesign*`, `NotificationAsset`, `NotificationSend`, Cloudinary | The product | Life of the account | Account deletion (database and Cloudinary) |

Card numbers and UPI details never reach ShopRoom; Razorpay Checkout handles them.

## Processors

Twilio (phone OTP), Razorpay (payments), Firebase/Google (sign-in, push), Cloudinary (images), SMTP provider (email OTP), Pexels/Unsplash (stock-image search; queries only).

## Data-subject requests

- **Erasure**: `DELETE /api/customers/me` and `DELETE /api/shopkeeper/me` (password, or a fresh Google sign-in for Google-only customers). Everything above is removed in one transaction; Cloudinary images are deleted best-effort afterwards.
- **Withdraw location consent**: `PATCH /api/customers/me { allowLocationAccess: false }` erases the stored position immediately.
- **Sign out everywhere**: `POST /api/customers/me/logout-all`, `POST /api/shopkeeper/logout-all`.
- **Access/export**: not automated yet; serve manually from the tables above until a self-service export exists.

## Logs

Logs must not contain passwords, tokens, OTP codes, email addresses or full phone numbers. Audited 2026-10-30: customer ids and OTP codes were removed from logs and phone numbers are masked (`+91••••••3210`). Prisma errors are logged by message only.
