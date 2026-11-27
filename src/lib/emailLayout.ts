/**
 * lib/emailLayout.ts — The look shared by every email CounterCircle sends.
 *
 * Email clients ignore most modern CSS, so this is table based with inline styles. Every dynamic value
 * is escaped by the helpers here, so callers pass plain text. Links point at the web app
 * (FRONTEND_BASE_URL); the footer carries the policy links and a one-line reason for the email.
 */

const BRAND = "CounterCircle";
const COLOR = {
  primary: "#4329BB",
  primaryTint: "#F5F2FF",
  ink: "#19192F",
  body: "#474554",
  muted: "#7A7790",
  line: "#ECE8F8",
  page: "#F2F0FA",
  success: "#0F6E56",
  successTint: "#E1F5EE",
  warnTint: "#FFF6E5",
  warnInk: "#7A4B00",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** An absolute link into the web app. */
export function siteUrl(path = ""): string {
  const base = (process.env.FRONTEND_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path}`;
}

const FOOTER_LINKS: { label: string; path: string }[] = [
  { label: "Privacy Policy", path: "/privacy" },
  { label: "Terms of Service", path: "/terms" },
  { label: "Help Center", path: "/help" },
  { label: "Contact us", path: "/contact" },
];

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${COLOR.body};">${escapeHtml(text)}</p>`;
}

/** The six-digit code. Kept in its own element so it is easy to read and copy. */
export function codeBlock(code: string): string {
  return `<div style="margin:8px 0 20px;padding:18px 12px;background:${COLOR.primaryTint};border-radius:12px;text-align:center;"><div style="font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:10px;font-size:36px;line-height:44px;font-weight:700;color:${COLOR.primary};text-indent:10px;">${escapeHtml(code)}</div></div>`;
}

export function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 20px;"><tr><td style="border-radius:10px;background:${COLOR.primary};"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a></td></tr></table>`;
}

type NoticeTone = "info" | "warn" | "success";

export function notice(title: string, text: string, tone: NoticeTone = "info"): string {
  const bg = tone === "warn" ? COLOR.warnTint : tone === "success" ? COLOR.successTint : COLOR.primaryTint;
  const ink = tone === "warn" ? COLOR.warnInk : tone === "success" ? COLOR.success : COLOR.ink;
  return `<div style="margin:0 0 16px;padding:14px 16px;background:${bg};border-radius:10px;font-size:13px;line-height:20px;color:${COLOR.body};"><strong style="color:${ink};">${escapeHtml(title)}</strong><br>${escapeHtml(text)}</div>`;
}

export function detailsTable(rows: [string, string][]): string {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:10px 0;border-top:1px solid ${COLOR.line};font-size:14px;color:${COLOR.muted};vertical-align:top;">${escapeHtml(label)}</td><td style="padding:10px 0 10px 16px;border-top:1px solid ${COLOR.line};font-size:14px;font-weight:600;color:${COLOR.ink};text-align:right;word-break:break-all;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border-bottom:1px solid ${COLOR.line};">${cells}</table>`;
}

/** The link as readable text, for clients where a button does not work. */
export function linkFallback(url: string): string {
  return `<p style="margin:0 0 16px;font-size:12px;line-height:18px;color:${COLOR.muted};">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(url)}" style="color:${COLOR.primary};word-break:break-all;">${escapeHtml(url)}</a></p>`;
}

export interface EmailContent {
  /** The grey preview line shown next to the subject in an inbox. */
  preheader: string;
  heading: string;
  /** Built with the helpers above. */
  bodyHtml: string;
  /** Why this person is getting the email, in one sentence. */
  reason: string;
  /** Extra footer HTML such as an unsubscribe link, already escaped. */
  extraFooterHtml?: string;
}

function businessLine(): string | null {
  const name = process.env.INVOICE_SELLER_NAME?.trim();
  const address = process.env.INVOICE_SELLER_ADDRESS?.trim();
  const parts = [name, address].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : null;
}

export function renderEmail(content: EmailContent): string {
  const links = FOOTER_LINKS.map(
    (l) => `<a href="${escapeHtml(siteUrl(l.path))}" style="color:${COLOR.primary};text-decoration:none;">${l.label}</a>`,
  ).join(`<span style="color:${COLOR.line};"> &nbsp;|&nbsp; </span>`);
  const business = businessLine();
  const logo = siteUrl("/CounterCircleIcon.png");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(content.preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.page};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${FONT};">
    <tr><td align="center" style="padding:0 0 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:10px;"><img src="${escapeHtml(logo)}" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;"></td>
        <td style="font-size:22px;font-weight:700;color:${COLOR.ink};letter-spacing:-0.3px;">${BRAND}</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border-radius:16px;border:1px solid ${COLOR.line};overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="height:5px;background:${COLOR.primary};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:32px 32px 12px;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:700;color:${COLOR.ink};">${escapeHtml(content.heading)}</h1>
          ${content.bodyHtml}
        </td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:22px 12px 0;font-size:12px;line-height:20px;color:${COLOR.muted};">
      <p style="margin:0 0 10px;">${escapeHtml(content.reason)}</p>
      <p style="margin:0 0 10px;">${links}</p>
      ${content.extraFooterHtml ? `<p style="margin:0 0 10px;">${content.extraFooterHtml}</p>` : ""}
      <p style="margin:0 0 4px;">${BRAND} connects local shops with the people who shop there.</p>
      ${business ? `<p style="margin:0 0 4px;">${escapeHtml(business)}</p>` : ""}
      <p style="margin:0;">&copy; ${new Date().getFullYear()} ${BRAND}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** The same footer as plain text, for the text part of the email. */
export function textFooter(reason: string): string {
  const links = FOOTER_LINKS.map((l) => `${l.label}: ${siteUrl(l.path)}`).join("\n");
  return ["", "--", reason, "", links, "", `(c) ${new Date().getFullYear()} ${BRAND}`].join("\n");
}
