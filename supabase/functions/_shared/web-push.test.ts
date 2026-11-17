import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode, encryptPayload, sendWebPush, vapidAuthorization } from './web-push.ts';

const encoder = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** What the browser does on receipt (RFC 8291), used to prove the payload decrypts. */
async function browserDecrypt(body: Uint8Array, uaPrivate: CryptoKey, uaPublic: Uint8Array, authSecret: Uint8Array) {
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const asPublic = body.slice(21, 21 + idLength);
  const cipher = body.slice(21 + idLength);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const info = new Uint8Array([...encoder.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, shared, info, 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function makeSubscriber() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, publicRaw, auth, p256dh: base64UrlEncode(publicRaw), authB64: base64UrlEncode(auth) };
}

async function makeVapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { pair, keys: { publicKey: base64UrlEncode(publicRaw), privateKey: jwk.d!, subject: 'mailto:hello@mova-beauty.co' } };
}

describe('web push', () => {
  it('encrypts a payload the subscriber can decrypt (aes128gcm)', async () => {
    const subscriber = await makeSubscriber();
    const body = await encryptPayload(encoder.encode('{"title":"New booking request"}'), subscriber.p256dh, subscriber.authB64);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(await browserDecrypt(body, subscriber.pair.privateKey, subscriber.publicRaw, subscriber.auth)).toBe('{"title":"New booking request"}');
  });

  it('signs a VAPID JWT for the push service origin that verifies with the public key', async () => {
    const vapid = await makeVapid();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid.keys, 1_700_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, key] = match!;
    expect(key).toBe(vapid.keys.publicKey);
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims!)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 43_200, sub: 'mailto:hello@mova-beauty.co' });
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.pair.publicKey, base64UrlDecode(signature!), encoder.encode(`${head}.${claims}`));
    expect(valid).toBe(true);
  });

  it('reports expired subscriptions as gone', async () => {
    const subscriber = await makeSubscriber();
    const vapid = await makeVapid();
    const sent: RequestInit[] = [];
    const result = await sendWebPush({ endpoint: 'https://push.example/x', p256dh: subscriber.p256dh, auth: subscriber.authB64 }, { title: 't' }, vapid.keys, {
      fetcher: (async (_url: string, init: RequestInit) => { sent.push(init); return new Response(null, { status: 410 }); }) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, status: 410, gone: true });
    expect((sent[0]!.headers as Record<string, string>)['Content-Encoding']).toBe('aes128gcm');
  });
});
