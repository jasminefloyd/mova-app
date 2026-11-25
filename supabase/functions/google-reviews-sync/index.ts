import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { googleProvider } from '../_shared/google-connection.ts';
import { syncGoogleReviews } from '../_shared/google-review-sync.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';

// Task 5.9 / P6: import the stylist's Google reviews through the one Google connection. Needs the platform
// flag MOVA_GOOGLE_REVIEWS_ENABLED=true, a provider (MOVA_GOOGLE_PROVIDER), an active connection with the
// Business Profile permission and a chosen Business Profile location, and the stylist's review-import switch.
// Nothing here posts to Google.
Deno.serve(withSystemRequestLogging('google-reviews-sync', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  if (!await platformSwitchEnabled('reviews')) return respond({ code: 'REVIEWS_FEATURE_DISABLED', synced: false }, 403);
  // Never imply that Google data was fetched when it was not.
  if (Deno.env.get('MOVA_GOOGLE_REVIEWS_ENABLED') !== 'true') return respond({ code: 'GOOGLE_REVIEWS_NOT_ENABLED', synced: false }, 409);
  const provider = googleProvider(request);
  if (!provider) return respond({ code: 'GOOGLE_NOT_CONFIGURED', synced: false }, 503);
  const db = serviceClient();
  const result = await syncGoogleReviews(db, provider, actor.businessId);
  if (!result.synced) return respond({ code: result.code, synced: false }, result.status);
  return respond({ synced: true, imported: result.imported, provider: provider.name, live: provider.live });
}));
