import { accessTokenFor, businessProfileReady, loadConnection } from './google-connection.ts';
import type { GoogleProvider } from './providers/google/index.ts';

type Db = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>; from: (table: string) => any };
export type GoogleReviewSyncResult = { synced: true; imported: number } | { synced: false; code: string; status: number };

/**
 * Imports one stylist's Google reviews through the one Google connection (task 5.9, Connections CN4).
 * Used by the stylist's own refresh (google-reviews-sync) and by job-dispatch every 6 hours.
 * Never posts anything to Google. The first import is recorded so later reviews can alert the stylist.
 */
export async function syncGoogleReviews(db: Db, provider: GoogleProvider, businessId: string, now = new Date()): Promise<GoogleReviewSyncResult> {
  const { data: features } = await db.rpc('mova_stylist_features', { p_artist_business_id: businessId });
  if ((features as Record<string, unknown> | null)?.google_review_import !== true) return { synced: false, code: 'GOOGLE_IMPORT_TURNED_OFF', status: 409 };
  const connection = await loadConnection(db as never, businessId).catch(() => null);
  if (!businessProfileReady(connection)) return { synced: false, code: 'GOOGLE_LOCATION_NOT_SET', status: 409 };
  let reviews;
  try { reviews = await provider.listReviews(await accessTokenFor(provider, connection), connection.business_location_id!); } catch { return { synced: false, code: 'GOOGLE_FETCH_FAILED', status: 502 }; }
  const at = now.toISOString();
  if (reviews.length) {
    const { error } = await db.from('mova_google_reviews').upsert(reviews.map((review) => ({
      artist_business_id: businessId, provider_review_id: review.id, rating: review.rating, body: review.body, display_name: review.displayName,
      provider_created_at: review.createdAt, provider_updated_at: review.updatedAt, synced_at: at,
    })), { onConflict: 'artist_business_id,provider_review_id' });
    if (error) return { synced: false, code: 'GOOGLE_REVIEWS_SAVE_FAILED', status: 500 };
  }
  const { error: settingsError } = await db.from('mova_review_settings').upsert({ artist_business_id: businessId, google_synced_at: at }, { onConflict: 'artist_business_id' });
  if (settingsError) return { synced: false, code: 'GOOGLE_REVIEWS_SAVE_FAILED', status: 500 };
  return { synced: true, imported: reviews.length };
}
