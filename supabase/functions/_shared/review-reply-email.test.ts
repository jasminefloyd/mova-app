import { describe, expect, it } from 'vitest';
import { FakeEmailProvider, renderEmail } from './providers/email/index';
import { sendFirstReviewReplyEmail } from './review-reply-email';

// RV-D1: the first reply to a Mova review is emailed once, with an unsubscribe link.
const context = { to: 'keisha@example.com', client_id: 'c1', locale: 'en-US', client_name: 'Keisha D.', business_name: 'Ari Monroe Hair', handle: 'ari-monroe', service_name: 'Silk press', rating: 5, review_body: 'Best silk press.', reply: 'Thank you, Keisha!' };

function fakeDb(options: { context?: unknown; claimed?: boolean; insertError?: boolean } = {}) {
  const rpcs: string[] = []; const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const db = {
    rpcs, inserts,
    rpc: async (name: string) => {
      rpcs.push(name);
      if (name === 'mova_review_reply_email_context') return { data: 'context' in options ? options.context : context, error: null };
      if (name === 'mova_review_reply_email_claim') return { data: options.claimed ?? true, error: null };
      if (name === 'mova_email_send_gate' || name === 'mova_messaging_reserve_spend') return { data: { allowed: true }, error: null };
      if (name === 'mova_artist_email_sender') return { data: { handle: 'ari-monroe', reply_to: 'ari@example.com' }, error: null };
      return { data: null, error: null };
    },
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        const result = { error: table === 'mova_email_unsubscribe_tokens' && options.insertError ? { message: 'nope' } : null };
        return Object.assign(Promise.resolve(result), { select: () => ({ single: async () => ({ data: { id: 'm1' }, error: null }) }) });
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
  return db;
}
const input = { reviewId: 'r1', artistBusinessId: 'b1', publicBaseUrl: 'https://mova-beauty.co', postalAddress: '1 Main St' };

describe('review reply email', () => {
  it('RV-EM-01 sends the first reply with an unsubscribe link', async () => {
    const db = fakeDb(); const provider = new FakeEmailProvider();
    expect(await sendFirstReviewReplyEmail(db as never, provider, input)).toBe('sent');
    expect(db.inserts.find((i) => i.table === 'mova_email_unsubscribe_tokens')?.row).toMatchObject({ client_id: 'c1', purpose: 'review_requests' });
    const message = db.inserts.find((i) => i.table === 'mova_messages')?.row;
    expect(message).toMatchObject({ purpose: 'review_reply', channel: 'email' });
    expect(String(message?.body)).toContain('Thank you, Keisha!');
    expect(String(message?.body)).toMatch(/Stop review emails from Ari Monroe Hair: https:\/\/mova-beauty\.co\/unsubscribe\/[A-Za-z0-9_-]{40,}/);
  });

  it('RV-EM-02 sends nothing when email is off, already sent, or the client opted out', async () => {
    expect(await sendFirstReviewReplyEmail(fakeDb() as never, null, input)).toBe('off');
    expect(await sendFirstReviewReplyEmail(fakeDb({ context: null }) as never, new FakeEmailProvider(), input)).toBe('already_sent');
    expect(await sendFirstReviewReplyEmail(fakeDb({ claimed: false }) as never, new FakeEmailProvider(), input)).toBe('already_sent');
    expect(await sendFirstReviewReplyEmail(fakeDb({ context: { skip: 'unsubscribed' } }) as never, new FakeEmailProvider(), input)).toBe('unsubscribed');
  });

  it('RV-EM-03 gives the claim back when it cannot send', async () => {
    const db = fakeDb({ insertError: true });
    expect(await sendFirstReviewReplyEmail(db as never, new FakeEmailProvider(), input)).toBe('failed');
    expect(db.rpcs).toContain('mova_review_reply_email_release');
  });

  it('RV-EM-04 renders in Spanish with the review and the reply', () => {
    const rendered = renderEmail('review_reply', 'es-US', { clientName: 'Sofía', businessName: 'Ari', serviceName: '', startsAt: new Date().toISOString(), timeZone: 'UTC', locationName: '', reviewReply: { firstName: 'Sofía', businessName: 'Ari', rating: 4, reviewBody: 'Me encantó.', reply: '¡Gracias, Sofía!', unsubscribeUrl: 'https://mova-beauty.co/unsubscribe/abc' } });
    expect(rendered.subject).toBe('Ari respondió a tu reseña');
    expect(rendered.text).toContain('¡Gracias, Sofía!');
    expect(rendered.html).toContain('https://mova-beauty.co/unsubscribe/abc');
  });
});
