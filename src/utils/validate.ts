import z from "zod";
import type { Request } from "express";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: z.ZodError };

export function parseBody<T>(
  req: Request,
  schema: z.ZodSchema<T>,
): ValidationResult<T> {
  const result = schema.safeParse(req.body);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: result.error };
}
