// Task 5.5 + Connections › Meta (CN5): Instagram DMs and Facebook Page messages for the Concierge.
// The live Meta Graph provider is in live.ts (owner decision O6 keeps it off until Meta approves the app);
// the fake in fake.ts is for tests and local runs.
export type MetaChannel = 'instagram' | 'messenger';
/** pageId is the account the message was sent to: the Instagram account id, or the Facebook Page id. */
export type InstagramInbound = { pageId: string; senderId: string; text: string; messageId: string; channel: MetaChannel };
export interface InstagramProvider {
  readonly name: string;
  readonly live: boolean;
  /** Replies through the stylist's Facebook Page. accessToken is the Page token (the fake ignores it). */
  send(input: { pageId: string; recipientId: string; text: string; idempotencyKey: string; accessToken?: string; channel?: MetaChannel }): Promise<{ messageId: string }>;
  /** Verifies and parses a webhook; null when the signature or payload is invalid. */
  parseInbound(request: Request): Promise<InstagramInbound | null>;
}

/** One Facebook Page the stylist manages, with the Instagram professional account linked to it. */
export type MetaPage = { id: string; name: string; accessToken: string; instagram: { id: string; username: string } | null };

/** The connect side of Meta: Facebook Login for Business, Pages and webhook subscriptions. */
export interface MetaConnectProvider {
  readonly name: string;
  readonly live: boolean;
  authorizationUrl(state: string): string;
  /** Code from the Facebook Login redirect → a long-lived user token. */
  exchangeCode(code: string): Promise<{ userToken: string; scopes: string[] }>;
  listPages(userToken: string): Promise<MetaPage[]>;
  subscribePage(page: MetaPage): Promise<void>;
  unsubscribePage(pageId: string, pageToken: string): Promise<void>;
  revoke(userToken: string): Promise<void>;
}

export const META_SCOPES = ['pages_show_list', 'pages_manage_metadata', 'pages_messaging', 'instagram_basic', 'instagram_manage_messages', 'business_management'];
