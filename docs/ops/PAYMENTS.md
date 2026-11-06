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
| A full refund is made in the Razorpay dashboard | The days that payment bought are taken off the plan, the order becomes `REFUNDED`, billing history shows "Refunded". Partial: alert, plan untouched. |
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
   - Active events: `order.paid`, `payment.captured`, `payment.failed`, `refund.processed`.
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

## GST tax invoices

Each payment can have a tax invoice, shown to the shopkeeper as an "Invoice" link in their billing history (printable, "Print or save as PDF"). Invoicing is **off until the business configures it**: `INVOICE_SELLER_NAME`, `INVOICE_SELLER_GSTIN` (checksum-validated), `INVOICE_SELLER_ADDRESS`, `INVOICE_SAC` and `INVOICE_GST_RATE` (optional `INVOICE_PREFIX`, default `SR`). The code assumes none of these: the GSTIN, SAC code and rate are yours and should be confirmed with your accountant. A half-filled setup logs a warning at start-up and issues nothing.

How it behaves:

- **Prices are GST-inclusive.** The amount a customer pays is the invoice total; the tax is taken out of it (taxable value = total ÷ (1 + rate)).
- **CGST + SGST or IGST.** If the buyer's place of supply is the seller's state, the tax is split into CGST and SGST halves (an odd paisa goes to SGST); otherwise it is IGST. The place of supply is the state in the buyer's GSTIN if they added one, else their shop's state name. A state name we cannot read (for example "MH") is **not guessed**: the invoice shows IGST and no place-of-supply code.
- **Numbers.** `SR/2026-27/000001`: sequential per Indian financial year (April to March, by the payment's date in India), assigned the first time an invoice is requested, under a row lock so two invoices never share a number and a number is only used if its invoice is saved. Because numbers are assigned on first request, an invoice nobody opens has no number yet.
- **Frozen.** The invoice is saved as a snapshot when issued; changing the shop's address, GSTIN or the configured rate afterwards does not alter it.
- **Buyer GSTIN.** Optional, set by the shopkeeper on the billing page, validated (format, state code and check character). It affects invoices issued after it is saved.
- **Refunds.** An invoice for a refunded payment still exists and is marked "This payment was refunded". **Credit notes are not generated**; if your accounting needs them, issue them outside this system.

```sql
-- Invoices issued, and what is left to issue
SELECT "invoiceNumber", "invoicedAt", amount / 100 AS rupees FROM "PlanPayment" WHERE "invoiceNumber" IS NOT NULL ORDER BY "invoiceNumber";
SELECT * FROM "InvoiceCounter";
```

## Operating it

Orders that need a person:

```sql
SELECT id, "razorpayOrderId", "razorpayPaymentId", amount / 100 AS rupees, "failureReason", "updatedAt"
FROM "PaymentOrder" WHERE status = 'NEEDS_REFUND' ORDER BY "updatedAt";
```

If one stays there, find the payment in the Razorpay dashboard and refund it by hand; the next webhook redelivery or daily job then finds it already refunded and marks it `REFUNDED` (Razorpay's "already refunded" answer counts as done).

Reconciling: every `FULFILLED` order has one `PlanPayment` row (the shopkeeper's billing history). Captured payments in the dashboard that have no `PaymentOrder` were not made through this app.

Refunds started **from the dashboard** are detected through the `refund.processed` webhook event (enable it, see "Switching it on"). A **full** refund of a granted purchase takes back the plan days that purchase added (never below "now"), marks the order `REFUNDED` and shows "Refunded" next to the payment in the shopkeeper's billing history; the account itself stays, so they can renew. A **partial** refund changes nothing and raises a `refund_external` alert for you to decide (two part-refunds that add up to the whole count as a full one). Refunds we issue ourselves are not treated this way. Refunds are not offered by default (see the Terms), so this exists for the cases where you choose to give the money back.

Metrics and alerts: `razorpay_webhook_events_total{result}`, `payment_verifications_total{outcome}`, `payment_refunds_total{result}`; the `refund_failed` alert fires when a refund does not go through. See `OBSERVABILITY.md` and `prometheus-alerts.yml`.

## Tests

`src/routes/payments.http.integration.test.ts` runs the whole lifecycle against the real app and database with real HMAC signatures, faking only Razorpay's network client: ordering, confirmation, webhook-first, races, refunds, outages and clean-up. `src/lib/razorpay.test.ts` covers the wrapper, and `registration` / `billing` suites cover the sign-up and renewal screens' API.

## Not covered yet

Credit notes for refunded invoices, partial refunds, and e-invoicing (IRN/QR) for businesses above the government's e-invoice threshold; the invoices here are not e-invoices.
