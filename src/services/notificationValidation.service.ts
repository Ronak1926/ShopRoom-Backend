/**
 * services/notificationValidation.service.ts — Design schema validation.
 *
 * Wraps the canonical Zod schema so controllers and other services get a
 * consistent { valid, errors, data } result without each re-implementing the
 * flattening of Zod issues into client-safe messages.
 */

import {
  NotificationDesignSchema,
  type NotificationDesign,
} from "../schemas/notification.schema.js";

export interface DesignValidationIssue {
  path: string;
  message: string;
}

export type DesignValidationResult =
  | { valid: true; data: NotificationDesign }
  | { valid: false; issues: DesignValidationIssue[] };

export function validateDesign(input: unknown): DesignValidationResult {
  const parsed = NotificationDesignSchema.safeParse(input);
  if (parsed.success) {
    return { valid: true, data: parsed.data };
  }
  const issues = parsed.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  return { valid: false, issues };
}
