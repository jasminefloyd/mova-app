import { artistClient, corsHeaders, respond } from '../_shared/booking.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!await artistClient(request)) return respond({ code: 'UNAUTHENTICATED' }, 401);
  // A-05 and A-20 remain open; never imply that Google data was fetched.
  if (Deno.env.get('MOVA_GOOGLE_REVIEWS_ENABLED') !== 'true' || Deno.env.get('MOVA_PUBLIC_REVIEWS_ENABLED') !== 'true') return respond({ code: 'GOOGLE_REVIEWS_NOT_ENABLED', synced: false }, 409);
  return respond({ code: 'GOOGLE_PROVIDER_NOT_CONFIGURED', synced: false }, 503);
});
