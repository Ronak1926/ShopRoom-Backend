/**
 * services/publicForms.service.ts — The two forms on the public site: the
 * contact form (relayed by email, not stored) and the newsletter sign-up
 * (the address is kept until the person unsubscribes or asks us to delete it).
 */

import { prisma } from "../database/prisma.js";
import { sendContactEmail, type ContactMessage } from "../lib/email.js";

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

/** Idempotent: subscribing twice is the same as once, and the caller cannot tell whether the address was already there. */
export async function subscribeToNewsletter(email: string): Promise<void> {
  await prisma.newsletterSubscriber.createMany({ data: [{ email }], skipDuplicates: true });
}
