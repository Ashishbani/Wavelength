/**
 * Outbound email via plain fetch — no SDK dependencies. Two providers:
 *
 *  Brevo (preferred when configured — free tier delivers to ANY recipient once
 *  a single sender address is verified, no domain needed):
 *    BREVO_API_KEY — from https://brevo.com → SMTP & API → API keys
 *    MAIL_FROM     — the sender you verified under Senders, e.g.
 *                    "Wavelength <wavelength.render@gmail.com>"
 *
 *  Resend (requires a VERIFIED DOMAIN to reach recipients other than the
 *  account owner):
 *    RESEND_API_KEY, MAIL_FROM — e.g. "Wavelength <noreply@yourdomain>"
 *
 * When neither is configured, password reset is unavailable and says so.
 */

export type SendMail = (to: string, subject: string, text: string) => Promise<void>;

export function isMailConfigured(): boolean {
  return !!process.env.MAIL_FROM && (!!process.env.BREVO_API_KEY || !!process.env.RESEND_API_KEY);
}

/** Split 'Name <addr>' into its parts (plain 'addr' works too). */
export function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^(.*)<([^>]+)>\s*$/);
  if (!m) return { email: from.trim() };
  const name = m[1].trim().replace(/^"+|"+$/g, '');
  return name ? { name, email: m[2].trim() } : { email: m[2].trim() };
}

export function createMailer(): SendMail | null {
  const from = process.env.MAIL_FROM;
  if (!from) return null;

  if (process.env.BREVO_API_KEY) {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = parseFrom(from);
    return async (to, subject, text) => {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Mail send failed (${res.status}): ${body.slice(0, 200)}`);
      }
    };
  }

  if (process.env.RESEND_API_KEY) {
    const apiKey = process.env.RESEND_API_KEY;
    // Resend only sends FROM domains you own and verify — public mailbox
    // domains (gmail etc.) are always refused with a 403.
    if (/@(gmail|googlemail|yahoo|outlook|hotmail|icloud|proton|protonmail)\./i.test(from)) {
      console.warn(
        `[wavelength] WARNING: MAIL_FROM (${from}) uses a public email domain — Resend will refuse ` +
        'every send with a 403. Use "Wavelength <onboarding@resend.dev>" for testing, a verified ' +
        'domain, or switch to Brevo (BREVO_API_KEY) which verifies single sender addresses.',
      );
    }
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

  return null;
}
