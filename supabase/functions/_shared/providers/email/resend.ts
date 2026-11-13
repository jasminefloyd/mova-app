import type { EmailProvider, EmailSendInput, EmailSendResult } from './types.ts';

// Owner decision (Nov 13, approval A-03): Resend for email. Unwired by default: emailProviderFromEnv only
// returns it when MOVA_EMAIL_PROVIDER=resend, MOVA_MESSAGING_LIVE_EMAIL=true and the Resend env values are set.
// Tested with a fake fetcher only; this file has never sent a real email.

export type ResendConfig = {
  apiKey: string;          // re_…
  fromAddress: string;     // an address on a domain verified in Resend, e.g. bookings@mova-beauty.co
  fromName?: string;
  costMicros?: number;     // estimate reserved against the monthly cap; default $0.001 per email
};

// Resend tag names and values allow only ASCII letters, numbers, underscores and dashes (256 characters).
const tagValue = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  readonly live = true;

  constructor(private readonly config: ResendConfig, private readonly fetcher: typeof fetch = fetch) {
    if (!/^re_[A-Za-z0-9_]{16,}$/.test(config.apiKey) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(config.fromAddress)) throw new Error('RESEND_CONFIG_INVALID');
  }

  estimateCostMicros() { return this.config.costMicros ?? 1000; }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const payload = {
      from: `${(this.config.fromName ?? 'Mova').replace(/[<>"\r\n]/g, '')} <${this.config.fromAddress}>`,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      // Echoed back on Resend webhooks. Delivery receipts are matched on the returned email id.
      tags: [{ name: 'mova_template', value: tagValue(input.templateId) }, { name: 'mova_locale', value: tagValue(input.locale) }],
    };
    const response = await this.fetcher('https://api.resend.com/emails', {
      method: 'POST',
      // Resend de-duplicates on Idempotency-Key for 24 hours, so a retried job cannot send twice.
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey.slice(0, 256) },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`RESEND_SEND_FAILED_${response.status}`);
    const body = await response.json().catch(() => null) as { id?: unknown } | null;
    const id = typeof body?.id === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(body.id) ? body.id : null;
    // Without an id the delivery receipt could never be matched, so treat it as a failed send.
    if (!id) throw new Error('RESEND_SEND_NO_ID');
    return { providerMessageId: id, status: 'queued' };
  }
}
