import type { InstagramInbound, InstagramProvider } from './types.ts';

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
export async function fakeMetaSignature(body: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
}
const equal = (a: string, b: string) => { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };

/**
 * Fake Instagram provider: never reaches Instagram. Webhooks are JSON {page_id,sender_id,text,id}
 * signed with HMAC-SHA256 (hex) in x-mova-fake-meta-signature using MOVA_META_FAKE_WEBHOOK_SECRET.
 */
export class FakeInstagramProvider implements InstagramProvider {
  readonly name = 'fake';
  readonly live = false;
  readonly outbox: Array<{ pageId: string; recipientId: string; text: string; idempotencyKey: string; messageId: string }> = [];
  constructor(private readonly webhookSecret: string | null = null) {}

  send(input: { pageId: string; recipientId: string; text: string; idempotencyKey: string }) {
    const existing = this.outbox.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existing) return Promise.resolve({ messageId: existing.messageId });
    const messageId = `fake_ig_${crypto.randomUUID()}`;
    this.outbox.push({ ...input, messageId });
    return Promise.resolve({ messageId });
  }

  async parseInbound(request: Request): Promise<InstagramInbound | null> {
    if (!this.webhookSecret) return null;
    const raw = await request.text();
    const signature = request.headers.get('x-mova-fake-meta-signature') ?? '';
    if (!equal(signature, await fakeMetaSignature(raw, this.webhookSecret))) return null;
    const body = (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; } })();
    if (!body) return null;
    const pick = (key: string, max: number) => typeof body[key] === 'string' && (body[key] as string).trim() && (body[key] as string).length <= max ? (body[key] as string).trim() : null;
    const pageId = pick('page_id', 64), senderId = pick('sender_id', 64), text = pick('text', 1000), messageId = pick('id', 128);
    return pageId && senderId && text && messageId ? { pageId, senderId, text, messageId } : null;
  }
}

export function instagramProviderFromEnv(env: (name: string) => string | undefined): InstagramProvider | null {
  return env('MOVA_INSTAGRAM_PROVIDER') === 'fake' ? new FakeInstagramProvider(env('MOVA_META_FAKE_WEBHOOK_SECRET') ?? null) : null;
}
