import { describe, expect, it } from 'vitest';
import { MetaGraphProvider, metaConnectProviderFromEnv, metaMessagingProviderFromEnv, metaSignature, parseMetaWebhook } from './live';

const config = { appId: '1234567890', appSecret: 'app-secret', redirectUri: 'https://x.invalid/functions/v1/meta-connect', version: 'v23.0' };
const env = (values: Record<string, string>) => (name: string) => values[name];

describe('Meta Graph provider (Connections CN5)', () => {
  it('reads Instagram and Facebook Page messages and skips echoes', () => {
    const ig = { object: 'instagram', entry: [{ id: '17840001', messaging: [{ sender: { id: '5550001' }, message: { mid: 'mid.1', text: ' Any openings Friday? ' } }] }] };
    expect(parseMetaWebhook(ig)).toEqual({ pageId: '17840001', senderId: '5550001', text: 'Any openings Friday?', messageId: 'mid.1', channel: 'instagram' });
    const page = { object: 'page', entry: [{ id: '10001', messaging: [{ sender: { id: '7770001' }, message: { mid: 'm_2', text: 'Hi!' } }] }] };
    expect(parseMetaWebhook(page)?.channel).toBe('messenger');
    const echo = { object: 'page', entry: [{ id: '10001', messaging: [{ sender: { id: '10001' }, message: { mid: 'm_3', text: 'Our reply', is_echo: true } }] }] };
    expect(parseMetaWebhook(echo)).toBeNull();
    expect(parseMetaWebhook({ object: 'whatsapp_business_account', entry: [] })).toBeNull();
  });

  it('only accepts webhooks signed with the app secret', async () => {
    const provider = new MetaGraphProvider(config, () => Promise.reject(new Error('no network')));
    const raw = JSON.stringify({ object: 'page', entry: [{ id: '10001', messaging: [{ sender: { id: '7770001' }, message: { mid: 'm_2', text: 'Hi!' } }] }] });
    const good = new Request('https://x.invalid', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': await metaSignature(raw, 'app-secret') } });
    expect((await provider.parseInbound(good))?.text).toBe('Hi!');
    const bad = new Request('https://x.invalid', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': await metaSignature(raw, 'other') } });
    expect(await provider.parseInbound(bad)).toBeNull();
  });

  it('asks for the messaging permissions and replies through the Page token', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const provider = new MetaGraphProvider(config, (input, init) => { calls.push({ url: String(input), body: init?.body as string | undefined }); return Promise.resolve(new Response(JSON.stringify({ message_id: 'm_out' }), { status: 200 })); });
    expect(provider.authorizationUrl('s'.repeat(64))).toContain('instagram_manage_messages');
    expect(await provider.send({ pageId: '10001', recipientId: '7770001', text: 'See you Friday', idempotencyKey: 'k', accessToken: 'page-token' })).toEqual({ messageId: 'm_out' });
    expect(calls[0].url).toContain('/v23.0/me/messages?access_token=page-token');
    expect(JSON.parse(calls[0].body!)).toEqual({ recipient: { id: '7770001' }, messaging_type: 'RESPONSE', message: { text: 'See you Friday' } });
    await expect(provider.send({ pageId: '10001', recipientId: '7770001', text: 'x', idempotencyKey: 'k' })).rejects.toThrow('META_SEND_INVALID');
  });

  it('stays off until it is switched on and configured', () => {
    expect(metaConnectProviderFromEnv(env({}))).toBeNull();
    expect(metaConnectProviderFromEnv(env({ MOVA_META_CONNECT_ENABLED: 'true', MOVA_META_PROVIDER: 'meta' }))).toBeNull();
    expect(metaConnectProviderFromEnv(env({ MOVA_META_CONNECT_ENABLED: 'true', MOVA_META_PROVIDER: 'meta', MOVA_META_APP_ID: '1234567890', MOVA_META_APP_SECRET: 's', MOVA_META_REDIRECT_URI: 'https://x.invalid/cb' }))?.live).toBe(true);
    expect(metaConnectProviderFromEnv(env({ MOVA_META_CONNECT_ENABLED: 'true', MOVA_META_PROVIDER: 'fake', MOVA_META_REDIRECT_URI: 'https://x.invalid/cb' }))?.live).toBe(false);
    expect(metaMessagingProviderFromEnv(env({ MOVA_INSTAGRAM_PROVIDER: 'fake' }))?.name).toBe('fake');
    expect(metaMessagingProviderFromEnv(env({}))).toBeNull();
  });
});
