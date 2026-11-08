import type { SmsInbound, SmsProvider, SmsSendInput, SmsSendResult } from './types.ts';

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');

export async function fakeSignature(body: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
}

/**
 * Fake SMS provider: never reaches a phone. Sends are kept in `outbox` (and in mova_messages by the
 * caller, with provider 'fake'). Inbound webhooks are JSON {from,to,text,id} signed with HMAC-SHA256
 * in the `x-mova-fake-sms-signature` header using MOVA_SMS_FAKE_WEBHOOK_SECRET.
 */
export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  readonly live = false;
  readonly outbox: (SmsSendInput & { providerMessageId: string })[] = [];
  private failNext = false;

  /** costMicros lets tests exercise the spend cap; the fake costs nothing by default. */
  constructor(private readonly webhookSecret: string | null = null, private readonly costMicros = 0) {}

  estimateCostMicros() { return this.costMicros; }

  /** Makes the next send throw, to test failure handling. */
  failOnce() { this.failNext = true; }

  send(input: SmsSendInput): Promise<SmsSendResult> {
    if (this.failNext) { this.failNext = false; return Promise.reject(new Error('FAKE_SMS_FAILURE')); }
    const existing = this.outbox.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existing) return Promise.resolve({ providerMessageId: existing.providerMessageId, status: 'sent' });
    const providerMessageId = `fake_sms_${crypto.randomUUID()}`;
    this.outbox.push({ ...input, providerMessageId });
    return Promise.resolve({ providerMessageId, status: 'sent' });
  }

  async parseInbound(request: Request): Promise<SmsInbound | null> {
    if (!this.webhookSecret) return null;
    const raw = await request.text();
    const signature = request.headers.get('x-mova-fake-sms-signature') ?? '';
    if (signature.length !== 64 || signature !== await fakeSignature(raw, this.webhookSecret)) return null;
    const body = (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; } })();
    if (!body || typeof body.from !== 'string' || typeof body.to !== 'string' || typeof body.text !== 'string') return null;
    return { from: body.from, to: body.to, text: body.text.slice(0, 1600), providerMessageId: typeof body.id === 'string' ? body.id : null };
  }
}
