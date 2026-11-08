import { describe, expect, it } from 'vitest';
import { sameSecret } from '../../admin-secret';
import { FakeEmailProvider } from './fake';
import { inviteSignupUrl, renderInviteEmail, sendInviteEmail } from './invite';
import type { EmailDb } from './send';

function stubDb(gate: Record<string, unknown> | null, spendAllowed = true) {
  const inserted: Record<string, unknown>[] = []; const updates: Record<string, unknown>[] = []; const rpcs: string[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push(name);
      if (name === 'mova_email_send_gate') { expect(args.p_artist_business_id).toBeNull(); return { data: gate, error: null }; }
      if (name === 'mova_messaging_reserve_spend') return { data: { allowed: spendAllowed }, error: null };
      return { data: null, error: { message: 'unexpected' } };
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: 'm1' }, error: null }) }) }; },
      update: (fields: Record<string, unknown>) => ({ eq: async () => { updates.push(fields); return { error: null }; } }),
    }),
  } as unknown as EmailDb;
  return { db, inserted, updates, rpcs };
}

describe('early access invite email (O2)', () => {
  it('renders both languages with the address to sign up with and an escaped link', () => {
    const en = renderInviteEmail('en-US', 'nia@example.com', 'https://mova-beauty.co/auth');
    expect(en.subject).toBe("You're invited to Mova early access");
    expect(en.text).toContain('nia@example.com');
    expect(en.html).toContain('href="https://mova-beauty.co/auth"');
    const es = renderInviteEmail('es-US', 'a<b@example.com', 'https://mova-beauty.co/auth');
    expect(es.subject).toBe('Tu invitación al acceso anticipado de Mova');
    expect(es.html).toContain('a&lt;b@example.com');
    expect(es.html).not.toContain('a<b@');
  });

  it('only links to an https site', () => {
    expect(inviteSignupUrl('https://mova-beauty.co/')).toBe('https://mova-beauty.co/auth');
    expect(inviteSignupUrl('javascript:alert(1)')).toBe('https://mova-beauty.co/auth');
    expect(inviteSignupUrl('http://mova-beauty.co')).toBe('https://mova-beauty.co/auth');
  });

  it('sends as a platform email that counts toward the spend cap', async () => {
    const { db, inserted, rpcs } = stubDb({ allowed: true });
    const fake = new FakeEmailProvider();
    const outcome = await sendInviteEmail(db, fake, { to: ' Nia@Example.com ', locale: 'es-US', signupUrl: 'https://mova-beauty.co/auth', idempotencyKey: 'email:early_access_invite:s1' });
    expect(outcome.status).toBe('sent');
    expect(inserted[0]).toMatchObject({ artist_business_id: null, client_id: null, channel: 'email', purpose: 'early_access_invite', origin: 'system' });
    expect(rpcs).toContain('mova_messaging_reserve_spend');
    expect(fake.outbox[0]).toMatchObject({ to: 'nia@example.com', templateId: 'early_access_invite', locale: 'es-US' });
  });

  it('respects suppressions and the spend cap', async () => {
    expect(await sendInviteEmail(stubDb({ allowed: false, reason: 'suppressed' }).db, new FakeEmailProvider(), { to: 'a@example.com', locale: 'en-US', signupUrl: 'https://x.co/auth', idempotencyKey: 'k' }))
      .toEqual({ status: 'suppressed', reason: 'suppressed' });
    const fake = new FakeEmailProvider();
    expect(await sendInviteEmail(stubDb({ allowed: true }, false).db, fake, { to: 'a@example.com', locale: 'en-US', signupUrl: 'https://x.co/auth', idempotencyKey: 'k' }))
      .toEqual({ status: 'suppressed', reason: 'spend_cap_reached' });
    expect(fake.outbox).toHaveLength(0);
  });
});

describe('admin secret (O2 waitlist-admin)', () => {
  const secret = 'a'.repeat(40);
  it('matches only the full secret and fails closed without one', () => {
    expect(sameSecret(secret, secret)).toBe(true);
    expect(sameSecret('a'.repeat(39) + 'b', secret)).toBe(false);
    expect(sameSecret(null, secret)).toBe(false);
    expect(sameSecret('short', 'short')).toBe(false);
    expect(sameSecret(secret, undefined)).toBe(false);
  });
});
