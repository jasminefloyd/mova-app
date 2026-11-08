import { describe, expect, it } from 'vitest';
import { derToRaw, parseSendGridEvents, parseTwilioStatus, verifySendGridSignature } from './status.ts';
import { twilioSignature } from './sms/twilio.ts';

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))));
function rawToDer(raw: Uint8Array) {
  const part = (bytes: Uint8Array) => { let v = bytes; while (v.length > 1 && v[0] === 0 && v[1]! < 0x80) v = v.slice(1); if (v[0]! >= 0x80) v = Uint8Array.of(0, ...v); return Uint8Array.of(0x02, v.length, ...v); };
  const r = part(raw.slice(0, 32)), s = part(raw.slice(32));
  return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
}

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

describe('SendGrid event webhook (O4)', () => {
  it('verifies the ECDSA signature over timestamp + payload', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const publicKey = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
    const raw = JSON.stringify([{ email: 'a@b.co', event: 'delivered', sg_message_id: 'abc.filter', mova_idempotency_key: 'email:evt-1' }]);
    const timestamp = '1762617600';
    const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(timestamp + raw)));
    expect(derToRaw(rawToDer(signature))).toEqual(signature);
    expect(await verifySendGridSignature(publicKey, raw, timestamp, b64(rawToDer(signature)), 1762617600)).toBe(true);
    expect(await verifySendGridSignature(publicKey, raw + ' ', timestamp, b64(rawToDer(signature)), 1762617600)).toBe(false);
    expect(await verifySendGridSignature(publicKey, raw, timestamp, b64(rawToDer(signature)), 1762617600 + 3600)).toBe(false);
  });
  it('maps delivery, bounces, complaints and unsubscribes', () => {
    const updates = parseSendGridEvents(JSON.stringify([
      { email: 'A@B.co', event: 'delivered', sg_message_id: 'm1.x', mova_idempotency_key: 'k1' },
      { email: 'a@b.co', event: 'bounce', sg_message_id: 'm2.x', mova_idempotency_key: 'k2' },
      { email: 'a@b.co', event: 'spamreport', sg_message_id: 'm3.x' },
      { email: 'a@b.co', event: 'open' },
    ]));
    expect(updates.map((u) => [u.status, u.suppress?.reason ?? null])).toEqual([['delivered', null], ['failed', 'bounce'], [null, 'complaint']]);
    expect(updates[0]).toMatchObject({ idempotencyKey: 'k1', providerMessageId: 'm1' });
    expect(parseSendGridEvents('not json')).toEqual([]);
  });
});
