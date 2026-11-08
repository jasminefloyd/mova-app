import { smsSegments } from '../spend.ts';
import type { SmsInbound, SmsProvider, SmsSendInput, SmsSendResult } from './types.ts';

// Owner decision O4 (Nov 8): Twilio for SMS. Unwired by default: smsProviderFromEnv only returns it when
// MOVA_SMS_PROVIDER=twilio, MOVA_MESSAGING_LIVE_SMS=true and the Twilio env values are all present.
// Tested with a fake fetcher only; no live keys exist.

const encoder = new TextEncoder();
const base64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

export type TwilioConfig = {
  accountSid: string;      // AC…
  authToken: string;
  webhookUrl: string;      // the exact public URL Twilio posts inbound texts to (used in the signature)
  statusCallbackUrl?: string | null;
  segmentCostMicros?: number; // estimate reserved against the monthly cap; default $0.0083 per segment
};

/** Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export async function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  const key = await crypto.subtle.importKey('raw', encoder.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return base64(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  readonly live = true;

  constructor(private readonly config: TwilioConfig, private readonly fetcher: typeof fetch = fetch) {
    if (!/^AC[0-9a-f]{32}$/i.test(config.accountSid) || config.authToken.length < 16 || !/^https:\/\//.test(config.webhookUrl)) throw new Error('TWILIO_CONFIG_INVALID');
  }

  estimateCostMicros(input: SmsSendInput) {
    return smsSegments(input.body) * (this.config.segmentCostMicros ?? 8300);
  }

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    if (!/^\+1\d{10}$/.test(input.to) || !/^\+1\d{10}$/.test(input.from)) throw new Error('TWILIO_NUMBER_INVALID');
    const form = new URLSearchParams({ To: input.to, From: input.from, Body: input.body });
    if (this.config.statusCallbackUrl) form.set('StatusCallback', this.config.statusCallbackUrl);
    // Twilio has no idempotency header; mova_messages' unique idempotency key prevents a second send.
    const response = await this.fetcher(`https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${this.config.accountSid}:${this.config.authToken}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !body || typeof body.sid !== 'string' || !/^SM[0-9a-f]{32}$/i.test(body.sid)) throw new Error(`TWILIO_SEND_FAILED${body?.code ? `_${String(body.code)}` : ''}`);
    return { providerMessageId: body.sid, status: body.status === 'sent' ? 'sent' : 'queued' };
  }

  async parseInbound(request: Request): Promise<SmsInbound | null> {
    const raw = await request.text();
    const params = Object.fromEntries(new URLSearchParams(raw));
    const signature = request.headers.get('x-twilio-signature') ?? '';
    const expected = await twilioSignature(this.config.authToken, this.config.webhookUrl, params);
    if (signature.length !== expected.length) return null;
    let diff = 0;
    for (let index = 0; index < expected.length; index += 1) diff |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
    if (diff !== 0 || params.AccountSid !== this.config.accountSid) return null;
    if (typeof params.From !== 'string' || typeof params.To !== 'string' || typeof params.Body !== 'string') return null;
    return { from: params.From, to: params.To, text: params.Body.slice(0, 1600), providerMessageId: params.MessageSid ?? null };
  }
}
