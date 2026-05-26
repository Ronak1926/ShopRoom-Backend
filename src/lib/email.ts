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
