# Payments (Razorpay)

Shopkeepers pay once for a 1, 2 or 3 month plan: when they register, and again whenever they renew. This page explains how that works, how to switch it on, and what to do when something goes wrong.

## How a payment flows

```
Browser                         API                                  Razorpay
  | POST create-order  ------->  checks the buyer, creates a PaymentOrder row, ---> orders.create
  |                              reuses an unpaid order for the same plan
  | <------ order id, amount, public key
  | opens Checkout  ------------------------------------------------>  card / UPI / netbanking
  | <----------------------------------------- order id, payment id, signature
  | POST verify  ------------->  signature ok? order is ours and theirs? -> grant ONCE
  |                                                                 |
  |                              POST /payment/webhook  <-----------+  order.paid (signed, retried for ~24 h)
  |                              same grant, same lock: whichever arrives first wins
```

Two things tell us a payment happened, and either is enough:

- **The browser** confirms right after Checkout. It is quick, but the tab can close or the network can drop.
- **Razorpay's webhook** arrives regardless. It is what makes a purchase survive a closed tab.

Both end in one function that locks the order row, so a purchase is granted **exactly once** however the two interleave. Granting and recording happen in one transaction: a payment is never half applied.

### What is trusted, and what is not

| Comes from | Trusted for |
| --- | --- |
| Our `PaymentOrder` row (written when the order was created) | the plan, the amount, who it is for |
| Razorpay's HMAC on the confirmation (`order id \| payment id`, key secret) | "this payment really belongs to this order" |
| Razorpay's HMAC on a webhook (raw body, webhook secret) | "Razorpay really sent this" |
| The browser's request body | nothing about money: plan and amount are never read from it |

A webhook is also compared with our row before anything is granted: it must be `captured`, in `INR`, for exactly the order's amount.

## Order states (`PaymentOrder.status`)

| State | Meaning |
| --- | --- |
| `CREATED` | The order exists at Razorpay and nothing has been paid. Orders nobody pays are deleted after 90 days. |
| `FULFILLED` | Paid and granted (account created, or plan extended). |
| `REFUNDED` | Paid but it could not be granted; the money was returned automatically. |
| `NEEDS_REFUND` | Paid, could not be granted, and the automatic refund did not go through. It is retried (below). |

## Situations and what happens

| Situation | Result |
| --- | --- |
| Buyer pays, browser confirms | Granted; the page continues. |
| Buyer pays, then closes the tab | The webhook grants it. For a new shop they log in with the email and password they chose. |
| Buyer pays, confirmation call fails (offline, server hiccup) | The page retries three times, then says "Payment received, please don't pay again" with the payment reference. The webhook completes it; the billing page checks for it automatically. |
| Browser and webhook arrive together, or either arrives twice | One grant. The other gets the same answer. |
| The email got an account while the buyer was paying, or the sign-up session is gone | Not granted. The payment is refunded in full and the buyer is told so. |
| Refund call fails (Razorpay unreachable) | Order stays `NEEDS_REFUND`, an alert fires, the webhook answers 503 so Razorpay redelivers, and a daily job retries. |
| A second, different payment arrives for an already paid order | It is refunded; the order is untouched. |
| Webhook with a wrong signature | 401, counted, alerts after 3 in 10 minutes. |
| Webhook for an order this app did not create | Ignored (the Razorpay account may take other payments). |
| Webhook amount, currency or status does not match | Never granted, logged, alert raised for a person to look at. |
| Our database fails mid-grant | Rolled back, webhook answers 500, Razorpay retries. Nothing is half applied. |
| Razorpay is down when starting a payment | "The payment service is unavailable" (503 for a timeout or 5xx, 502 for a rejected key). No order row is left behind. |
| Buyer clicks Pay twice, or reopens Checkout | The same unpaid order (up to 2 hours old) is reused. |
| A purchase is granted | One receipt email goes to the shopkeeper (see below). Whichever of the browser and the webhook grants it sends it; repeats do not. |

## Switching it on

1. **Test keys.** Razorpay Dashboard → switch to *Test Mode* → Settings → API Keys → Generate. Put them in `ShopRoom-Backend/.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_…
   RAZORPAY_KEY_SECRET=…
   ```
   Leave both empty to keep using mock payments (no window opens, nothing is charged). The browser needs no Razorpay setting: the API hands it the public key.
2. **Webhook secret.** Dashboard → Settings → Webhooks → Add New Webhook.
   - URL: `https://<your-api-domain>/api/shopkeeper/payment/webhook`
   - Secret: any long random string (`openssl rand -hex 32`). Put the same value in `.env` as `RAZORPAY_WEBHOOK_SECRET`. It is **not** the API key secret.
   - Active events: `order.paid`, `payment.captured`, `payment.failed`.
   Razorpay must be able to reach the URL, so on a laptop use a tunnel (ngrok, cloudflared) and register the tunnel address.
3. **Try it.** Sign up as a shopkeeper and pay in Checkout. Razorpay's test-mode instructions list test cards and UPI ids (for example card `4111 1111 1111 1111` with any future expiry and CVV, and UPI `success@razorpay` / `failure@razorpay`); check the dashboard for the current list. Then pay and close the tab straight away: the webhook should still create the account.
4. **Go live.** Complete Razorpay's KYC, generate **live** keys (`rzp_live_…`), create a second webhook for the production URL with its own secret, and set all three variables in the production environment. The server refuses to start in production with a malformed `RAZORPAY_KEY_ID`, and logs a warning if it is a test key (payments would succeed without real money moving).

Use test keys on staging and live keys only on production; never share a webhook secret between environments.

## Receipts

A receipt is an email with the shop, plan, amount, date, Razorpay payment id and our order reference. It is sent right after the purchase is granted, and it is never part of the payment: if the mail fails, the buyer still gets their account or their extra time, the failure is logged, and nothing is shown to them.

`PaymentOrder.receiptSentAt` makes it once-only: the sender sets it before sending and clears it if the mail fails. The daily maintenance job retries any fulfilled order that still has none, for a week (and not within the first 10 minutes, while the original sender may still be working). If SMTP is not configured, receipts are skipped with a warning and picked up by that job once it is.

This is a payment receipt, not a GST tax invoice. See "Not covered yet".

```sql
SELECT id, "fulfilledAt" FROM "PaymentOrder" WHERE status = 'FULFILLED' AND "receiptSentAt" IS NULL ORDER BY "fulfilledAt";
```

## Operating it

Orders that need a person:

```sql
SELECT id, "razorpayOrderId", "razorpayPaymentId", amount / 100 AS rupees, "failureReason", "updatedAt"
FROM "PaymentOrder" WHERE status = 'NEEDS_REFUND' ORDER BY "updatedAt";
```

If one stays there, find the payment in the Razorpay dashboard and refund it by hand; the next webhook redelivery or daily job then finds it already refunded and marks it `REFUNDED` (Razorpay's "already refunded" answer counts as done).

Reconciling: every `FULFILLED` order has one `PlanPayment` row (the shopkeeper's billing history). Captured payments in the dashboard that have no `PaymentOrder` were not made through this app.

Refunds started **from the dashboard** for a granted purchase are not detected and do not remove the plan. Refunds are not offered by default (see the Terms), so decide per case whether to also shorten the plan.

Metrics and alerts: `razorpay_webhook_events_total{result}`, `payment_verifications_total{outcome}`, `payment_refunds_total{result}`; the `refund_failed` alert fires when a refund does not go through. See `OBSERVABILITY.md` and `prometheus-alerts.yml`.

## Tests

`src/routes/payments.http.integration.test.ts` runs the whole lifecycle against the real app and database with real HMAC signatures, faking only Razorpay's network client: ordering, confirmation, webhook-first, races, refunds, outages and clean-up. `src/lib/razorpay.test.ts` covers the wrapper, and `registration` / `billing` suites cover the sign-up and renewal screens' API.

## Not covered yet

GST tax invoices (they need the business's GSTIN, invoice numbering and the buyer's billing details; the receipt email is not one), partial refunds, and automatic plan changes when a refund is made in the dashboard.
