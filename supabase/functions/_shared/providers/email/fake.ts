import type { EmailProvider, EmailSendInput, EmailSendResult } from './types.ts';

/**
 * Fake email provider: never sends. Each email is kept in `outbox`; the send pipeline also stores the
 * rendered text in mova_messages (channel 'email', provider 'fake'), which is the local table to inspect.
 */
export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  readonly live = false;
  readonly outbox: (EmailSendInput & { providerMessageId: string })[] = [];
  private failNext = false;

  /** costMicros lets tests exercise the spend cap; the fake costs nothing by default. */
  constructor(private readonly costMicros = 0) {}

  estimateCostMicros() { return this.costMicros; }

  failOnce() { this.failNext = true; }

  send(input: EmailSendInput): Promise<EmailSendResult> {
    if (this.failNext) { this.failNext = false; return Promise.reject(new Error('FAKE_EMAIL_FAILURE')); }
    const existing = this.outbox.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existing) return Promise.resolve({ providerMessageId: existing.providerMessageId, status: 'sent' });
    const providerMessageId = `fake_email_${crypto.randomUUID()}`;
    this.outbox.push({ ...input, providerMessageId });
    return Promise.resolve({ providerMessageId, status: 'sent' });
  }
}
