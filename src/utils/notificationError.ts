/**
 * utils/notificationError.ts — Typed error for the notification module so
 * services can signal an HTTP status without importing Express. Controllers
 * map `NotificationError` to its status; any other throw becomes a sanitized 500.
 */

export class NotificationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "NotificationError";
    this.status = status;
  }

  static notFound(message = "Not found") {
    return new NotificationError(404, message);
  }

  static forbidden(message = "Not allowed on your current plan") {
    return new NotificationError(403, message);
  }

  static badRequest(message = "Invalid request") {
    return new NotificationError(400, message);
  }
}
