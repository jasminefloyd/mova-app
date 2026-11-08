import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { googleReviewsProviderFromEnv } from '../_shared/providers/gbp/reviews.ts';

// Task 5.9: import the stylist's Google reviews. Platform flag MOVA_GOOGLE_REVIEWS_ENABLED stays off
// until the Google connection is live (O11); the stylist's google_review_import switch (default ON,
// 0053) and a saved location id are also required. Only the fake provider exists today.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  // Never imply that Google data was fetched when it was not.
  if (Deno.env.get('MOVA_GOOGLE_REVIEWS_ENABLED') !== 'true') return respond({ code: 'GOOGLE_REVIEWS_NOT_ENABLED', synced: false }, 409);
  const provider = googleReviewsProviderFromEnv((name) => Deno.env.get(name));
  if (!provider) return respond({ code: 'GOOGLE_PROVIDER_NOT_CONFIGURED', synced: false }, 503);
  const db = serviceClient();
  const { data: features } = await db.rpc('mova_stylist_features', { p_artist_business_id: actor.businessId });
  if (features?.google_review_import !== true) return respond({ code: 'GOOGLE_IMPORT_TURNED_OFF', synced: false }, 409);
  const { data: settings } = await db.from('mova_review_settings').select('google_location_id').eq('artist_business_id', actor.businessId).maybeSingle();
  if (!settings?.google_location_id) return respond({ code: 'GOOGLE_LOCATION_NOT_SET', synced: false }, 409);
  let reviews;
  try { reviews = await provider.listReviews(settings.google_location_id); } catch { return respond({ code: 'GOOGLE_FETCH_FAILED', synced: false }, 502); }
  const now = new Date().toISOString();
  if (reviews.length) {
    const { error } = await db.from('mova_google_reviews').upsert(reviews.map((review) => ({
      artist_business_id: actor.businessId, provider_review_id: review.id, rating: review.rating, body: review.body, display_name: review.displayName,
      provider_created_at: review.createdAt, provider_updated_at: review.updatedAt, synced_at: now,
    })), { onConflict: 'artist_business_id,provider_review_id' });
    if (error) return respond({ code: 'GOOGLE_REVIEWS_SAVE_FAILED', synced: false }, 500);
  }
  await db.from('mova_review_settings').update({ google_synced_at: now }).eq('artist_business_id', actor.businessId);
  return respond({ synced: true, imported: reviews.length, provider: provider.name, live: provider.live });
});
