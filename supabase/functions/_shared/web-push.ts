/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291),
 * using WebCrypto only, so it runs the same in Supabase Edge Functions and in unit tests.
 */
export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type PushSendResult = { ok: true; status: number } | { ok: false; status: number; gone: boolean };

const encoder = new TextEncoder();
// Typed-array → BufferSource without the TS 5.9 ArrayBufferLike mismatch.
const buf = (bytes: Uint8Array) => bytes as unknown as BufferSource;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, key, length * 8);
  return new Uint8Array(bits);
}

/** Encrypts a payload for one subscription (aes128gcm, single record). */
export async function encryptPayload(payload: Uint8Array, p256dh: string, auth: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPublic = base64UrlDecode(p256dh);
  const authSecret = base64UrlDecode(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('PUSH_SUBSCRIPTION_KEYS_INVALID');
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(concat(payload, new Uint8Array([2])))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** Signed VAPID JWT for the push service that owns `endpoint`. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const publicKey = base64UrlDecode(vapid.publicKey);
  if (publicKey.length !== 65) throw new Error('VAPID_PUBLIC_KEY_INVALID');
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: vapid.privateKey,
    x: base64UrlEncode(publicKey.slice(1, 33)), y: base64UrlEncode(publicKey.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64UrlEncode(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 60 * 60, sub: vapid.subject })));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, buf(encoder.encode(`${header}.${claims}`))));
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`;
}

export async function sendWebPush(subscription: PushSubscriptionKeys, payload: unknown, vapid: VapidKeys, options: { ttlSeconds?: number; urgency?: 'normal' | 'high'; topic?: string; fetcher?: typeof fetch } = {}): Promise<PushSendResult> {
  const body = await encryptPayload(encoder.encode(JSON.stringify(payload)), subscription.p256dh, subscription.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(subscription.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(options.ttlSeconds ?? 60 * 60 * 24),
    Urgency: options.urgency ?? 'high',
  };
  if (options.topic) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const response = await (options.fetcher ?? fetch)(subscription.endpoint, { method: 'POST', headers, body: buf(body) });
  if (response.ok) return { ok: true, status: response.status };
  // 404/410: the subscription is gone (uninstalled, permission revoked); stop sending to it.
  return { ok: false, status: response.status, gone: response.status === 404 || response.status === 410 };
}

export function vapidFromEnv(env: (name: string) => string | undefined): VapidKeys | null {
  const publicKey = env('MOVA_VAPID_PUBLIC_KEY');
  const privateKey = env('MOVA_VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env('MOVA_VAPID_SUBJECT') || 'mailto:hello@mova-beauty.co' };
}
