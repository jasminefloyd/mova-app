import { artistClient } from './booking.ts';

Deno.test('TC-SEC-FUZZ-01 artistClient constrains service-role scope to the selected membership', async () => {
  const priorUrl = Deno.env.get('SUPABASE_URL');
  const priorKey = Deno.env.get('SUPABASE_ANON_KEY');
  const priorFetch = globalThis.fetch;
  const userId = 'f6666666-6666-4666-8666-666666666661';
  const stylistBBusinessId = 'f5555555-5555-4555-8555-555555555551';
  const observed: { membershipUrl: URL | null } = { membershipUrl: null };
  Deno.env.set('SUPABASE_URL', 'http://supabase.local');
  Deno.env.set('SUPABASE_ANON_KEY', 'local-anon-key');
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: userId, aud: 'authenticated', role: 'authenticated' });
    }
    if (url.pathname === '/rest/v1/mova_artist_memberships') {
      observed.membershipUrl = url;
      return Response.json({ artist_business_id: stylistBBusinessId });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }) as typeof fetch;

  try {
    const actor = await artistClient(new Request('http://local/functions/v1/test', {
      headers: {
        Authorization: 'Bearer synthetic-stylist-b-token',
        'x-mova-artist-business-id': stylistBBusinessId,
      },
    }));
    if (!actor || actor.businessId !== stylistBBusinessId || actor.user.id !== userId) {
      throw new Error('artistClient returned an identity or business outside the requested membership');
    }
    if (observed.membershipUrl?.searchParams.get('artist_business_id') !== `eq.${stylistBBusinessId}`
      || observed.membershipUrl?.searchParams.get('user_id') !== `eq.${userId}`) {
      throw new Error('membership lookup did not constrain both stylist identity and business');
    }
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) Deno.env.delete('SUPABASE_URL'); else Deno.env.set('SUPABASE_URL', priorUrl);
    if (priorKey === undefined) Deno.env.delete('SUPABASE_ANON_KEY'); else Deno.env.set('SUPABASE_ANON_KEY', priorKey);
  }
});
