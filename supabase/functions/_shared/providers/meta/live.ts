import { FakeInstagramProvider, FakeMetaConnectProvider } from './fake.ts';
import { META_SCOPES, type InstagramInbound, type InstagramProvider, type MetaChannel, type MetaConnectProvider, type MetaPage } from './types.ts';

// Connections › Meta (CN5): the live Meta Graph API. Used only when MOVA_META_PROVIDER=meta and the app id,
// secret and redirect are set (owner decision O6: Meta must approve the app first). Tokens never leave the
// Edge Functions; the webhook is verified with the app secret (X-Hub-Signature-256).

type Env = (name: string) => string | undefined;
type Json = Record<string, unknown>;
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
const equal = (a: string, b: string) => { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };
const ID = /^[0-9A-Za-z_-]{3,64}$/;

export async function metaSignature(body: string, appSecret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `sha256=${hex(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))}`;
}

/**
 * Reads the first text message in a Meta webhook. Instagram events arrive with object "instagram" (entry id =
 * the Instagram professional account); Facebook Page messages with object "page" (entry id = the Page).
 * Echoes of our own replies, reactions and attachments without text are ignored.
 */
export function parseMetaWebhook(payload: unknown): InstagramInbound | null {
  const body = payload && typeof payload === 'object' ? payload as Json : null;
  if (!body || (body.object !== 'instagram' && body.object !== 'page')) return null;
  const channel: MetaChannel = body.object === 'instagram' ? 'instagram' : 'messenger';
  for (const entry of Array.isArray(body.entry) ? body.entry as Json[] : []) {
    const pageId = typeof entry.id === 'string' ? entry.id : null;
    for (const event of Array.isArray(entry.messaging) ? entry.messaging as Json[] : []) {
      const message = event.message && typeof event.message === 'object' ? event.message as Json : null;
      const sender = event.sender && typeof event.sender === 'object' ? (event.sender as Json).id : null;
      if (!message || message.is_echo === true || typeof message.text !== 'string' || typeof message.mid !== 'string') continue;
      const text = message.text.trim();
      if (!pageId || !ID.test(pageId) || typeof sender !== 'string' || !ID.test(sender) || sender === pageId || !text || text.length > 1000 || message.mid.length > 256) continue;
      return { pageId, senderId: sender, text, messageId: message.mid, channel };
    }
  }
  return null;
}

export class MetaGraphProvider implements InstagramProvider, MetaConnectProvider {
  readonly name = 'meta';
  readonly live = true;
  private readonly graph: string;
  constructor(private readonly config: { appId: string; appSecret: string; redirectUri: string; version: string }, private readonly fetcher: typeof fetch = fetch) {
    this.graph = `https://graph.facebook.com/${config.version}`;
  }

  private async call(path: string, init: { method?: string; params?: Record<string, string>; body?: Json } = {}): Promise<Json> {
    const url = new URL(`${this.graph}${path}`);
    for (const [key, value] of Object.entries(init.params ?? {})) url.searchParams.set(key, value);
    const response = await this.fetcher(url, {
      method: init.method ?? 'GET',
      ...(init.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
    });
    const result = await response.json().catch(() => null) as Json | null;
    if (!response.ok || !result) throw new Error('META_REQUEST_FAILED');
    return result;
  }

  authorizationUrl(state: string) {
    const url = new URL(`https://www.facebook.com/${this.config.version}/dialog/oauth`);
    url.search = new URLSearchParams({ client_id: this.config.appId, redirect_uri: this.config.redirectUri, state, response_type: 'code', scope: META_SCOPES.join(',') }).toString();
    return url.toString();
  }

  async exchangeCode(code: string) {
    if (!/^[A-Za-z0-9_#-]{10,1024}$/.test(code)) throw new Error('META_CODE_INVALID');
    const short = await this.call('/oauth/access_token', { params: { client_id: this.config.appId, client_secret: this.config.appSecret, redirect_uri: this.config.redirectUri, code } });
    if (typeof short.access_token !== 'string') throw new Error('META_TOKEN_MISSING');
    const long = await this.call('/oauth/access_token', { params: { grant_type: 'fb_exchange_token', client_id: this.config.appId, client_secret: this.config.appSecret, fb_exchange_token: short.access_token } });
    const userToken = typeof long.access_token === 'string' ? long.access_token : short.access_token;
    const permissions = await this.call('/me/permissions', { params: { access_token: userToken } }).catch(() => ({ data: [] }) as Json);
    const scopes = (Array.isArray(permissions.data) ? permissions.data as Json[] : []).filter((row) => row.status === 'granted' && typeof row.permission === 'string').map((row) => String(row.permission));
    return { userToken, scopes };
  }

  async listPages(userToken: string): Promise<MetaPage[]> {
    const result = await this.call('/me/accounts', { params: { access_token: userToken, fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50' } });
    return (Array.isArray(result.data) ? result.data as Json[] : []).flatMap((row) => {
      if (typeof row.id !== 'string' || !ID.test(row.id) || typeof row.access_token !== 'string') return [];
      const ig = row.instagram_business_account && typeof row.instagram_business_account === 'object' ? row.instagram_business_account as Json : null;
      return [{ id: row.id, name: typeof row.name === 'string' ? row.name.slice(0, 200) : '', accessToken: row.access_token,
        instagram: ig && typeof ig.id === 'string' && ID.test(ig.id) ? { id: ig.id, username: typeof ig.username === 'string' ? ig.username.slice(0, 60) : '' } : null }];
    });
  }

  async subscribePage(page: MetaPage) {
    const result = await this.call(`/${page.id}/subscribed_apps`, { method: 'POST', params: { access_token: page.accessToken, subscribed_fields: 'messages' } });
    if (result.success !== true) throw new Error('META_SUBSCRIBE_FAILED');
  }

  async unsubscribePage(pageId: string, pageToken: string) {
    await this.call(`/${pageId}/subscribed_apps`, { method: 'DELETE', params: { access_token: pageToken } });
  }

  async revoke(userToken: string) {
    await this.call('/me/permissions', { method: 'DELETE', params: { access_token: userToken } });
  }

  async send(input: { pageId: string; recipientId: string; text: string; idempotencyKey: string; accessToken?: string; channel?: MetaChannel }) {
    if (!input.accessToken || !ID.test(input.recipientId)) throw new Error('META_SEND_INVALID');
    // Replies go out from the Page; Instagram replies use the same endpoint with the Instagram-scoped id.
    const result = await this.call('/me/messages', { method: 'POST', params: { access_token: input.accessToken },
      body: { recipient: { id: input.recipientId }, messaging_type: 'RESPONSE', message: { text: input.text.slice(0, 1000) } } });
    if (typeof result.message_id !== 'string') throw new Error('META_SEND_FAILED');
    return { messageId: result.message_id };
  }

  async parseInbound(request: Request): Promise<InstagramInbound | null> {
    const raw = await request.text();
    const signature = request.headers.get('x-hub-signature-256') ?? '';
    if (!equal(signature, await metaSignature(raw, this.config.appSecret))) return null;
    try { return parseMetaWebhook(JSON.parse(raw)); } catch { return null; }
  }
}

function liveConfig(env: Env) {
  const appId = env('MOVA_META_APP_ID'); const appSecret = env('MOVA_META_APP_SECRET'); const redirectUri = env('MOVA_META_REDIRECT_URI');
  if (!appId || !/^\d{5,30}$/.test(appId) || !appSecret || !redirectUri?.startsWith('https://')) return null;
  return { appId, appSecret, redirectUri, version: /^v\d{2}\.\d$/.test(env('MOVA_META_GRAPH_VERSION') ?? '') ? env('MOVA_META_GRAPH_VERSION')! : 'v23.0' };
}

/** The Meta connect flow, or null when it is switched off or not configured. */
export function metaConnectProviderFromEnv(env: Env, fetcher?: typeof fetch): MetaConnectProvider | null {
  if (env('MOVA_META_CONNECT_ENABLED') !== 'true') return null;
  if (env('MOVA_META_PROVIDER') === 'fake') {
    const callback = env('MOVA_META_REDIRECT_URI');
    return callback ? new FakeMetaConnectProvider(callback) : null;
  }
  if (env('MOVA_META_PROVIDER') !== 'meta') return null;
  const config = liveConfig(env);
  return config ? new MetaGraphProvider(config, fetcher) : null;
}

/** The message side: live Meta, the fake, or null. Replaces instagramProviderFromEnv for the webhook. */
export function metaMessagingProviderFromEnv(env: Env, fetcher?: typeof fetch): InstagramProvider | null {
  if (env('MOVA_META_PROVIDER') === 'meta' || env('MOVA_INSTAGRAM_PROVIDER') === 'meta') {
    const config = liveConfig(env);
    return config ? new MetaGraphProvider(config, fetcher) : null;
  }
  if (env('MOVA_INSTAGRAM_PROVIDER') === 'fake' || env('MOVA_META_PROVIDER') === 'fake') return new FakeInstagramProvider(env('MOVA_META_FAKE_WEBHOOK_SECRET') ?? null);
  return null;
}
