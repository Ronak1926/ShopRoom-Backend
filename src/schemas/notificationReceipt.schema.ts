import { z } from "zod";

export const ReceiptSchema = z.object({
  token: z.uuid(),
  event: z.enum(["DELIVERED", "OPENED", "CLICKED"]),
});

export type ReceiptInput = z.infer<typeof ReceiptSchema>;
