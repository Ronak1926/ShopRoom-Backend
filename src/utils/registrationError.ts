/**
 * An error whose message is safe to show the user as-is (wrong password, draft
 * expired, payment mismatch…). Anything else thrown during registration is an
 * internal failure and is answered with a generic message instead.
 */
export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}
