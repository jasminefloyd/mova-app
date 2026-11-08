import { describe, expect, it } from 'vitest';
import { FakeInstagramProvider, fakeMetaSignature, instagramProviderFromEnv } from './fake';

const signed = async (body: unknown, secret = 'test-secret') => { const raw = JSON.stringify(body); return new Request('https://x.invalid', { method: 'POST', body: raw, headers: { 'x-mova-fake-meta-signature': await fakeMetaSignature(raw, secret) } }); };

describe('FakeInstagramProvider (task 5.5)', () => {
  it('parses a correctly signed message', async () => {
    const provider = new FakeInstagramProvider('test-secret');
    expect(await provider.parseInbound(await signed({ page_id: 'page-1', sender_id: 'ig-77', text: 'Any openings Friday?', id: 'm-1' }))).toEqual({ pageId: 'page-1', senderId: 'ig-77', text: 'Any openings Friday?', messageId: 'm-1' });
  });
  it('rejects a bad signature, a missing secret and incomplete payloads', async () => {
    expect(await new FakeInstagramProvider('test-secret').parseInbound(await signed({ page_id: 'p', sender_id: 's', text: 't', id: 'i' }, 'other'))).toBeNull();
    expect(await new FakeInstagramProvider(null).parseInbound(await signed({ page_id: 'p', sender_id: 's', text: 't', id: 'i' }))).toBeNull();
    expect(await new FakeInstagramProvider('test-secret').parseInbound(await signed({ page_id: 'p', sender_id: 's', id: 'i' }))).toBeNull();
  });
  it('never sends twice for one idempotency key and is not live', async () => {
    const provider = new FakeInstagramProvider();
    const first = await provider.send({ pageId: 'p', recipientId: 'r', text: 'Hi', idempotencyKey: 'k1' });
    expect(await provider.send({ pageId: 'p', recipientId: 'r', text: 'Hi', idempotencyKey: 'k1' })).toEqual(first);
    expect(provider.outbox).toHaveLength(1);
    expect(provider.live).toBe(false);
  });
  it('is only chosen when the fake is configured', () => {
    expect(instagramProviderFromEnv(() => undefined)).toBeNull();
    expect(instagramProviderFromEnv((name) => (name === 'MOVA_INSTAGRAM_PROVIDER' ? 'meta' : undefined))).toBeNull();
    expect(instagramProviderFromEnv((name) => (name === 'MOVA_INSTAGRAM_PROVIDER' ? 'fake' : 's'))?.name).toBe('fake');
  });
});
