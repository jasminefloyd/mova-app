// Task 5.5: Instagram direct messages. The real Meta integration waits on owner decision O6; the only
// implementation is the fake in fake.ts.
export type InstagramInbound = { pageId: string; senderId: string; text: string; messageId: string };
export interface InstagramProvider {
  readonly name: string;
  readonly live: boolean;
  send(input: { pageId: string; recipientId: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }>;
  /** Verifies and parses a webhook; null when the signature or payload is invalid. */
  parseInbound(request: Request): Promise<InstagramInbound | null>;
}
