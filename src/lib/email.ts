import nodemailer from "nodemailer";

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS?.trim(),
    },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function sendOtpEmail(to: string, code: string) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: "Your ShopRoom verification code",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#F5F2FF;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <span style="font-size:22px;font-weight:700;color:#19192F;">🛍️ ShopRoom</span>
        </div>
        <div style="background:#fff;border-radius:10px;padding:32px;text-align:center;">
          <p style="font-size:16px;color:#474554;margin:0 0 16px;">Your verification code is:</p>
          <div style="letter-spacing:10px;font-size:36px;font-weight:700;color:#4329BB;margin:0 0 20px;">${code}</div>
          <p style="font-size:13px;color:#474554;margin:0;">This code expires in <strong>10 minutes</strong>.</p>
        </div>
        <p style="font-size:11px;color:#474554;text-align:center;margin-top:16px;opacity:0.6;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, link: string) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: "Reset your ShopRoom password",
    text: `Use this link to choose a new ShopRoom password (valid for 30 minutes):\n\n${link}\n\nIf you didn't ask for this, ignore this email. Your password won't change.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#F5F2FF;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;"><span style="font-size:22px;font-weight:700;color:#19192F;">ShopRoom</span></div>
        <div style="background:#fff;border-radius:10px;padding:32px;text-align:center;">
          <p style="font-size:16px;color:#474554;margin:0 0 20px;">Choose a new password for your ShopRoom account.</p>
          <a href="${escapeHtml(link)}" style="display:inline-block;background:#4329BB;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:10px;">Reset password</a>
          <p style="font-size:13px;color:#474554;margin:20px 0 0;">This link works once and expires in <strong>30 minutes</strong>.</p>
        </div>
        <p style="font-size:11px;color:#474554;text-align:center;margin-top:16px;opacity:0.6;">If you didn't ask for this, you can safely ignore this email. Your password won't change.</p>
      </div>
    `,
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
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    replyTo: contact.email,
    subject: `[ShopRoom contact] ${contact.subject}`.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: `From: ${contact.name} <${contact.email}>\n\n${contact.message}`,
    html: `<p><strong>From:</strong> ${escapeHtml(contact.name)} &lt;${escapeHtml(contact.email)}&gt;</p><p style="white-space:pre-wrap">${escapeHtml(contact.message)}</p>`,
  });
}

/** True when mail can actually be sent. Receipts are skipped (and retried later) rather than failing a payment when it is not. */
export function isEmailConfigured(): boolean {
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
  const what = receipt.purpose === "REGISTRATION" ? "ShopRoom sign-up" : "ShopRoom plan renewal";
  const rows: [string, string][] = [
    ["Shop", receipt.shopName],
    ["For", `${what}, ${receipt.planLabel} plan`],
    ["Amount paid", formatRupees(receipt.amount)],
    ["Paid on", RECEIPT_DATE.format(receipt.paidAt)],
    ["Payment id", receipt.paymentId],
    ["Order reference", receipt.orderRef],
  ];
  const greeting = receipt.recipientName ? `Hi ${receipt.recipientName},` : "Hi,";
  const text = [
    `${greeting}`,
    "",
    `Thank you. We received your payment of ${formatRupees(receipt.amount)} for the ${receipt.planLabel} ShopRoom plan.`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Keep this email as your receipt. Questions about a payment? Reply to this email or use the contact page, and quote the payment id.",
  ].join("\n");
  const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#F5F2FF;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;"><span style="font-size:22px;font-weight:700;color:#19192F;">ShopRoom</span></div>
        <div style="background:#fff;border-radius:10px;padding:28px;">
          <p style="font-size:16px;color:#19192F;margin:0 0 6px;font-weight:600;">Payment receipt</p>
          <p style="font-size:14px;color:#474554;margin:0 0 20px;">${escapeHtml(greeting)} thank you, we received your payment.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;color:#474554;">
            ${rows
              .map(
                ([label, value]) =>
                  `<tr><td style="padding:8px 0;border-top:1px solid #ECE8F8;">${escapeHtml(label)}</td><td style="padding:8px 0;border-top:1px solid #ECE8F8;text-align:right;color:#19192F;font-weight:600;word-break:break-all;">${escapeHtml(value)}</td></tr>`,
              )
              .join("")}
          </table>
        </div>
        <p style="font-size:11px;color:#474554;text-align:center;margin-top:16px;opacity:0.7;">Keep this email as your receipt. Questions about a payment? Reply to this email and quote the payment id.</p>
      </div>
    `;
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: `Your ShopRoom payment receipt (${formatRupees(receipt.amount)})`,
    text,
    html,
  });
}
