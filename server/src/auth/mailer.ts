/**
 * Outbound email via Resend's REST API (plain fetch — no SDK dependency).
 * Configure with env vars:
 *   RESEND_API_KEY  — from https://resend.com (free tier available)
 *   MAIL_FROM       — verified sender, e.g. "Wavelength <noreply@yourdomain>"
 * When unconfigured, password reset is unavailable and says so honestly.
 */

export type SendMail = (to: string, subject: string, text: string) => Promise<void>;

export function isMailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
}

export function createResendMailer(): SendMail | null {
  if (!isMailConfigured()) return null;
  const apiKey = process.env.RESEND_API_KEY!;
  const from = process.env.MAIL_FROM!;
  return async (to, subject, text) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mail send failed (${res.status}): ${body.slice(0, 200)}`);
    }
  };
}
