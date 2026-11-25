/**
 * An error from the payment flow whose message is safe to show the person paying as-is
 * ("this payment does not belong to your account", "your payment was refunded"…).
 * Anything else thrown in that flow is an internal failure and is answered generically.
 */
export class PaymentError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 502 | 503,
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
