import { describe, expect, it } from 'vitest';
import { parseResendEvent, parseTwilioStatus, verifyResendSignature } from './status.ts';
import { twilioSignature } from './sms/twilio.ts';

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))));

describe('Twilio status callbacks (O4)', () => {
  const sid = 'AC' + '0'.repeat(32), token = 'twilio-test-token-0000', url = 'https://project.supabase.invalid/functions/v1/messaging-status?provider=twilio';
  it('verifies the signature and reads status and real price', async () => {
    const params = { AccountSid: sid, MessageSid: 'SM' + 'c'.repeat(32), MessageStatus: 'delivered', Price: '-0.00830', PriceUnit: 'USD', To: '+15551230001' };
    const raw = new URLSearchParams(params).toString();
    expect(await parseTwilioStatus(raw, await twilioSignature(token, url, params), token, url, sid)).toEqual({
      provider: 'twilio', providerMessageId: params.MessageSid, idempotencyKey: null, status: 'delivered', costMicros: 8300, suppress: null });
    expect(await parseTwilioStatus(raw, 'bad', token, url, sid)).toBeNull();
  });
  it('treats Twilio-level STOP (21610) as a suppression', async () => {
    const params = { AccountSid: sid, MessageSid: 'SM' + 'd'.repeat(32), MessageStatus: 'undelivered', ErrorCode: '21610', To: '+15551230001' };
    const update = await parseTwilioStatus(new URLSearchParams(params).toString(), await twilioSignature(token, url, params), token, url, sid);
    expect(update).toMatchObject({ status: 'failed', suppress: { address: '+15551230001', reason: 'manual' } });
  });
});

describe('Resend webhook (Svix signature)', () => {
  const secretBytes = new Uint8Array(32).map((_, i) => i + 1);
  const secret = `whsec_${b64(secretBytes)}`;
  const sign = async (id: string, timestamp: string, raw: string) => {
    const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return `v1,${b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`))))}`;
  };
  it('verifies the signature over id, timestamp and payload, within five minutes', async () => {
    const raw = JSON.stringify({ type: 'email.delivered', data: { email_id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c', to: ['a@b.co'] } });
    const id = 'msg_2abc', timestamp = '1762617600';
    const signature = await sign(id, timestamp, raw);
    expect(await verifyResendSignature(secret, raw, { id, timestamp, signature }, 1762617600)).toBe(true);
    // A rotated secret sends several signatures; any valid one passes.
    expect(await verifyResendSignature(secret, raw, { id, timestamp, signature: `v1,AAAA ${signature}` }, 1762617600)).toBe(true);
    expect(await verifyResendSignature(secret, raw + ' ', { id, timestamp, signature }, 1762617600)).toBe(false);
    expect(await verifyResendSignature(secret, raw, { id: 'msg_other', timestamp, signature }, 1762617600)).toBe(false);
    expect(await verifyResendSignature(secret, raw, { id, timestamp, signature }, 1762617600 + 301)).toBe(false);
    expect(await verifyResendSignature('not-a-secret', raw, { id, timestamp, signature }, 1762617600)).toBe(false);
  });
  it('maps delivery, bounces and complaints, and ignores other events', () => {
    const event = (type: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type, data: { email_id: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c', to: ['A@B.co'], ...extra } });
    expect(parseResendEvent(event('email.delivered'))).toMatchObject({ provider: 'resend', providerMessageId: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c', idempotencyKey: null, status: 'delivered', suppress: null });
    expect(parseResendEvent(event('email.sent'))).toMatchObject({ status: 'sent' });
    expect(parseResendEvent(event('email.bounced'))).toMatchObject({ status: 'failed', suppress: { address: 'a@b.co', reason: 'bounce' } });
    expect(parseResendEvent(event('email.complained'))).toMatchObject({ status: null, suppress: { address: 'a@b.co', reason: 'complaint' } });
    expect(parseResendEvent(event('email.opened'))).toBeNull();
    expect(parseResendEvent(JSON.stringify({ type: 'email.delivered', data: { to: ['a@b.co'] } }))).toBeNull();
    expect(parseResendEvent('not json')).toBeNull();
  });
});
