/**
 * services/publicForms.service.ts — The two forms on the public site: the
 * contact form (relayed by email, not stored) and the newsletter sign-up
 * (the address is kept until the person unsubscribes or asks us to delete it).
 */

import { prisma } from "../database/prisma.js";
import { isEmailConfigured, sendContactEmail, sendNewsletterWelcomeEmail, type ContactMessage } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { createUnsubscribeToken, readUnsubscribeToken } from "../utils/unsubscribeToken.js";

/** Where contact messages go: CONTACT_EMAIL, else the mailbox the app already sends from. */
export function contactInbox(env: Record<string, string | undefined> = process.env): string | null {
  return env.CONTACT_EMAIL?.trim() || env.SMTP_USER?.trim() || null;
}

/** Returns false when no inbox is configured, so the caller can say so instead of pretending it was sent. */
export async function relayContactMessage(message: ContactMessage): Promise<boolean> {
  const inbox = contactInbox();
  if (!inbox) return false;
  await sendContactEmail(inbox, message);
  return true;
}

/** The token goes in the fragment, like the password-reset link, so it never reaches a server log or a Referer header. */
export function newsletterUnsubscribeUrl(email: string): string {
  const base = (process.env.FRONTEND_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/unsubscribe#token=${createUnsubscribeToken(email)}`;
}

/**
 * Idempotent: subscribing twice is the same as once, and the caller cannot tell whether the address was already there.
 * Only a new address gets the welcome email (with its way out), so repeating the form cannot be used to mail someone.
 */
export async function subscribeToNewsletter(email: string): Promise<void> {
  const { count } = await prisma.newsletterSubscriber.createMany({ data: [{ email }], skipDuplicates: true });
  if (count === 0 || !isEmailConfigured()) return;
  sendNewsletterWelcomeEmail(email, newsletterUnsubscribeUrl(email)).catch((err: unknown) => logger.warn("Newsletter welcome email failed", { error: (err as Error)?.message }));
}

/** Removes the address a valid token was made for. Returns false for a token we did not issue; true even if the address was already gone. */
export async function unsubscribeFromNewsletter(token: string): Promise<boolean> {
  const email = readUnsubscribeToken(token);
  if (!email) return false;
  await prisma.newsletterSubscriber.deleteMany({ where: { email } });
  return true;
}
