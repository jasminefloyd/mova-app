import type { EmailProvider, EmailSendInput, EmailSendResult } from './types.ts';

// Owner decision O4 (Nov 8): SendGrid for email. Unwired by default: emailProviderFromEnv only returns it
// when MOVA_EMAIL_PROVIDER=sendgrid, MOVA_MESSAGING_LIVE_EMAIL=true and the SendGrid env values are set.
// Tested with a fake fetcher only; no live keys exist.

export type SendGridConfig = {
  apiKey: string;          // SG.…
  fromAddress: string;     // a verified sender, e.g. bookings@mova-beauty.co
  fromName?: string;
  costMicros?: number;     // estimate reserved against the monthly cap; default $0.001 per email
  sandbox?: boolean;       // SendGrid sandbox mode: validates without delivering
};

export class SendGridEmailProvider implements EmailProvider {
  readonly name = 'sendgrid';
  readonly live = true;

  constructor(private readonly config: SendGridConfig, private readonly fetcher: typeof fetch = fetch) {
    if (!/^SG\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(config.apiKey) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.fromAddress)) throw new Error('SENDGRID_CONFIG_INVALID');
  }

  estimateCostMicros() { return this.config.costMicros ?? 1000; }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const payload = {
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: this.config.fromAddress, name: this.config.fromName ?? 'Mova' },
      subject: input.subject,
      content: [{ type: 'text/plain', value: input.text }, { type: 'text/html', value: input.html }],
      // Echoed back on SendGrid events, so delivery receipts can be matched to mova_messages.
      custom_args: { mova_idempotency_key: input.idempotencyKey, mova_template: input.templateId },
      categories: [`mova_${input.templateId}`],
      tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
      mail_settings: { sandbox_mode: { enable: this.config.sandbox === true } },
    };
    const response = await this.fetcher('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status !== 202 && response.status !== 200) throw new Error(`SENDGRID_SEND_FAILED_${response.status}`);
    const id = response.headers.get('x-message-id');
    return { providerMessageId: id && /^[A-Za-z0-9._-]{6,100}$/.test(id) ? id : `sendgrid_${input.idempotencyKey}`, status: 'queued' };
  }
}
