import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';

// RV-D1: the "Stop review emails" link in a review-reply email. The page asks the client to confirm, then
// posts here, so mail scanners that open links can't unsubscribe anyone. Tokens are one-use; reusing one
// still answers with the stylist's name and changes nothing.
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

Deno.serve(withSystemRequestLogging('email-unsubscribe', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(body.token)) return respond({ code: 'UNSUBSCRIBE_LINK_INVALID' }, 404);
  const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.token)));
  const { data, error } = await serviceClient().rpc('mova_email_unsubscribe', { p_token_hash: hash });
  if (error) return respond({ code: 'UNSUBSCRIBE_UNAVAILABLE' }, 500);
  if (!data) return respond({ code: 'UNSUBSCRIBE_LINK_INVALID' }, 404);
  return respond({ unsubscribed: true, business_name: (data as { business_name?: string }).business_name ?? null });
}));
