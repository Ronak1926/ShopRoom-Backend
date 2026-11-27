import nodemailer from "nodemailer";
import { button, codeBlock, detailsTable, escapeHtml, linkFallback, notice, paragraph, renderEmail, siteUrl, textFooter } from "./emailLayout.js";

interface MailMessage {
  from: string | undefined;
  to: string;
  replyTo?: string;
  subject: string;
  text?: string;
  html: string;
  headers?: Record<string, string>;
}

interface Mailer {
  sendMail(message: MailMessage): Promise<unknown>;
}

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const API_TIMEOUT_MS = 10_000;

/** The sender, as "Name <address>" or a bare address. MAIL_FROM wins; SMTP_FROM and SMTP_USER still work. */
function fromAddress(): string | undefined {
  return process.env.MAIL_FROM?.trim() || process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || undefined;
}

function splitAddress(value: string): { name?: string; email: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { email: value.trim() };
  const name = match[1].trim();
  return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
}

/**
 * Sends over HTTPS (port 443) instead of SMTP. Hosts such as Render's free plan block outgoing SMTP
 * ports, so mail never leaves; an HTTPS call is not affected.
 */
function brevoMailer(apiKey: string): Mailer {
  return {
    async sendMail(message) {
      if (!message.from) throw new Error("Email sender is not configured (set MAIL_FROM)");
      const body: Record<string, unknown> = {
        sender: splitAddress(message.from),
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
      };
      if (message.text) body.textContent = message.text;
      if (message.replyTo) body.replyTo = { email: message.replyTo };
      if (message.headers) body.headers = message.headers;

      const response = await fetch(BREVO_ENDPOINT, {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        throw new Error(`Email provider answered ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      return response.json().catch(() => null);
    },
  };
}

function getTransporter(): Mailer {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (apiKey) return brevoMailer(apiKey);
  // Short limits: a mail server that cannot be reached fails in seconds, not after the 2 minute default.
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS?.trim(),
    },
  });
  return { sendMail: (message) => transport.sendMail(message) };
}

export async function sendOtpEmail(to: string, code: string) {
  const reason = `You are receiving this because someone used ${to} to create a CounterCircle account.`;
  await getTransporter().sendMail({
    from: fromAddress(),
    to,
    subject: "Your CounterCircle verification code",
    text: [
      "Confirm your email address",
      "",
      `Your verification code is: ${code}`,
      "",
      "Enter it on the verification page to finish creating your account. It expires in 10 minutes.",
      "Never share this code with anyone. CounterCircle will never ask you for it.",
      "If you did not request it, you can ignore this email.",
      textFooter(reason),
    ].join("\n"),
    html: renderEmail({
      preheader: `Your CounterCircle verification code is ${code}. It expires in 10 minutes.`,
      heading: "Confirm your email address",
      reason,
      bodyHtml: [
        paragraph("Welcome to CounterCircle. Enter this code on the verification page to finish creating your account."),
        codeBlock(code),
        paragraph("The code expires in 10 minutes and works only once."),
        notice("Keep it private", "CounterCircle will never call, message or email you asking for this code. If someone does, do not share it.", "warn"),
        paragraph("If you did not try to create an account, you can safely ignore this email. Nothing will happen."),
      ].join(""),
    }),
  });
}

export async function sendPasswordResetEmail(to: string, link: string) {
  const reason = `You are receiving this because a password reset was requested for the CounterCircle account using ${to}.`;
  await getTransporter().sendMail({
    from: fromAddress(),
    to,
    subject: "Reset your CounterCircle password",
    text: [
      "Reset your password",
      "",
      "Use this link to choose a new CounterCircle password. It works once and is valid for 30 minutes:",
      link,
      "",
      "If you did not ask for this, ignore this email. Your password will not change.",
      textFooter(reason),
    ].join("\n"),
    html: renderEmail({
      preheader: "Choose a new password. The link works once and expires in 30 minutes.",
      heading: "Reset your password",
      reason,
      bodyHtml: [
        paragraph("We received a request to reset the password for your CounterCircle account. Choose a new one with the button below."),
        button("Choose a new password", link),
        paragraph("This link works once and expires in 30 minutes."),
        linkFallback(link),
        notice("Did not ask for this?", "Ignore this email and your password stays the same. If you are worried someone else is trying to get in, change your password after signing in and turn on two-step verification.", "warn"),
      ].join(""),
    }),
  });
}

export interface ContactMessage {
  name: string;
  email: string;
  subject: string;
  message: string;
}

/** Forwards a contact-form message to the team. The sender's address is only ever in Reply-To, never From. */
export async function sendContactEmail(to: string, contact: ContactMessage) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: fromAddress(),
    to,
    replyTo: contact.email,
    subject: `[CounterCircle contact] ${contact.subject}`.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: `From: ${contact.name} <${contact.email}>\n\n${contact.message}`,
    html: `<p><strong>From:</strong> ${escapeHtml(contact.name)} &lt;${escapeHtml(contact.email)}&gt;</p><p style="white-space:pre-wrap">${escapeHtml(contact.message)}</p>`,
  });
}

/** True when mail can actually be sent. Receipts are skipped (and retried later) rather than failing a payment when it is not. */
export function isEmailConfigured(): boolean {
  if (process.env.BREVO_API_KEY?.trim()) return Boolean(fromAddress());
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
}

export interface PaymentReceipt {
  recipientName: string | null;
  shopName: string;
  planLabel: string;
  purpose: "REGISTRATION" | "RENEWAL";
  /** Paise. */
  amount: number;
  paidAt: Date;
  paymentId: string;
  orderRef: string;
}

const RECEIPT_DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
const formatRupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function sendPaymentReceiptEmail(to: string, receipt: PaymentReceipt) {
  const what = receipt.purpose === "REGISTRATION" ? "CounterCircle sign-up" : "CounterCircle plan renewal";
  const rows: [string, string][] = [
    ["Shop", receipt.shopName],
    ["For", `${what}, ${receipt.planLabel} plan`],
    ["Amount paid", formatRupees(receipt.amount)],
    ["Paid on", RECEIPT_DATE.format(receipt.paidAt)],
    ["Payment id", receipt.paymentId],
    ["Order reference", receipt.orderRef],
  ];
  const greeting = receipt.recipientName ? `Hi ${receipt.recipientName},` : "Hi,";
  const reason = `You are receiving this receipt because a payment was made for ${receipt.shopName} on CounterCircle.`;
  const billingUrl = siteUrl("/shopkeeper/billing");
  const text = [
    greeting,
    "",
    `Thank you. We received your payment of ${formatRupees(receipt.amount)} for the ${receipt.planLabel} CounterCircle plan.`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `You can see this payment and your plan any time in Billing: ${billingUrl}`,
    "Keep this email as your receipt. Questions about a payment? Reply to this email or use the contact page, and quote the payment id.",
    textFooter(reason),
  ].join("\n");
  const html = renderEmail({
    preheader: `We received your payment of ${formatRupees(receipt.amount)} for the ${receipt.planLabel} plan.`,
    heading: "Payment receipt",
    reason,
    bodyHtml: [
      paragraph(`${greeting} thank you, we received your payment.`),
      notice(`${formatRupees(receipt.amount)} paid`, `${receipt.planLabel} plan for ${receipt.shopName}`, "success"),
      detailsTable(rows),
      button("View billing", billingUrl),
      paragraph("Keep this email as your receipt. Questions about a payment? Reply to this email and quote the payment id."),
    ].join(""),
  });
  await getTransporter().sendMail({
    from: fromAddress(),
    to,
    subject: `Your CounterCircle payment receipt (${formatRupees(receipt.amount)})`,
    text,
    html,
  });
}

/** Sent once, when an address joins the newsletter. It is also the person's way out. */
export async function sendNewsletterWelcomeEmail(to: string, unsubscribeUrl: string) {
  const reason = `You are receiving this because ${to} was subscribed to CounterCircle updates.`;
  await getTransporter().sendMail({
    from: fromAddress(),
    to,
    subject: "You're subscribed to CounterCircle updates",
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
    text: [
      "You're subscribed",
      "",
      "Thanks for subscribing to CounterCircle updates. We only email you when there is news worth sharing: new features, tips for growing a local shop, and important changes.",
      "",
      `If this wasn't you, or you've changed your mind, unsubscribe here: ${unsubscribeUrl}`,
      textFooter(reason),
    ].join("\n"),
    html: renderEmail({
      preheader: "Thanks for subscribing. We only email when there is news worth sharing.",
      heading: "You're subscribed",
      reason,
      extraFooterHtml: `Changed your mind? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#4329BB;">Unsubscribe here</a>.`,
      bodyHtml: [
        paragraph("Thanks for subscribing to CounterCircle updates."),
        paragraph("We only email you when there is news worth sharing: new features, tips for growing a local shop, and important changes."),
        button("Visit CounterCircle", siteUrl("/")),
        paragraph("If this was not you, you can unsubscribe with the link at the bottom of this email."),
      ].join(""),
    }),
  });
}
