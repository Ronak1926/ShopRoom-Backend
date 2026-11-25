import { z } from "zod";

export const RegisterDeviceSchema = z.object({
  fcmToken: z.string().trim().min(20).max(500),
  platform: z.enum(["WEB", "ANDROID", "IOS"]).default("WEB"),
});

export type RegisterDeviceInput = z.infer<typeof RegisterDeviceSchema>;

export const UnregisterDeviceSchema = z.object({
  fcmToken: z.string().trim().min(20).max(500),
});

export type UnregisterDeviceInput = z.infer<typeof UnregisterDeviceSchema>;
