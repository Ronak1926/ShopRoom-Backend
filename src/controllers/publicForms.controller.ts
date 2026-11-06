/**
 * controllers/publicForms.controller.ts — Contact form and newsletter sign-up.
 * Both are reachable without signing in, so the input is tightly bounded.
 */

import type { Request, Response } from "express";
import z from "zod";
import { relayContactMessage, subscribeToNewsletter, unsubscribeFromNewsletter } from "../services/publicForms.service.js";

const email = z.string().trim().toLowerCase().email().max(254);

/** Single-line text: control characters (including newlines) are rejected so a name or subject can't inject mail headers. */
const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]+$/);

const contactSchema = z.object({
  name: singleLine(100),
  email,
  subject: singleLine(150),
  message: z.string().trim().min(10).max(4000),
});

const newsletterSchema = z.object({ email });
const unsubscribeSchema = z.object({ token: z.string().min(1).max(600) });

// POST /api/public/contact
export async function contactHandler(req: Request, res: Response): Promise<void> {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Please fill in every field (message: 10 to 4000 characters)" });
    return;
  }
  try {
    if (!(await relayContactMessage(parsed.data))) {
      res.status(503).json({ message: "Contact form is unavailable right now. Please try again later." });
      return;
    }
    res.status(202).json({ message: "Thanks! We'll get back to you by email." });
  } catch (err) {
    console.error("Contact form failed:", (err as Error)?.message);
    res.status(502).json({ message: "We couldn't send your message. Please try again later." });
  }
}

// POST /api/public/newsletter
export async function newsletterHandler(req: Request, res: Response): Promise<void> {
  const parsed = newsletterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Enter a valid email address" });
    return;
  }
  try {
    await subscribeToNewsletter(parsed.data.email);
    res.status(201).json({ message: "You're subscribed." });
  } catch (err) {
    console.error("Newsletter sign-up failed:", (err as Error)?.message);
    res.status(500).json({ message: "Could not subscribe right now. Please try again later." });
  }
}

// POST /api/public/newsletter/unsubscribe
export async function newsletterUnsubscribeHandler(req: Request, res: Response): Promise<void> {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "This unsubscribe link is not valid." });
    return;
  }
  try {
    if (!(await unsubscribeFromNewsletter(parsed.data.token))) {
      res.status(400).json({ message: "This unsubscribe link is not valid." });
      return;
    }
    res.json({ message: "You have been unsubscribed." });
  } catch (err) {
    console.error("Newsletter unsubscribe failed:", (err as Error)?.message);
    res.status(500).json({ message: "Could not unsubscribe right now. Please try again." });
  }
}
