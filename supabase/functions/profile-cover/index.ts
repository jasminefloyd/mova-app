import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { unsplashProviderFromEnv, type UnsplashPhoto } from '../_shared/providers/unsplash/index.ts';

// Profile cover from Unsplash (P6). The browser only sends a search or a photo id. The photo is looked up
// again on the server, its download is triggered as Unsplash asks, and the credit is saved from Unsplash's
// own data. The client never supplies the image URL or the credit, so none of them can be spoofed.
// Actions: search, use, clear.
const SEARCH_LIMIT = 80;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** The photo as the picker may see it: no download endpoint. */
function publicPhoto(photo: UnsplashPhoto) {
  return { id: photo.id, alt: photo.alt, thumbUrl: photo.thumbUrl, imageUrl: photo.imageUrl, photographerName: photo.photographerName, photographerUrl: photo.photographerUrl, photoUrl: photo.photoUrl };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return respond({ code: 'REQUEST_INVALID' }, 422);
  const provider = unsplashProviderFromEnv((name) => Deno.env.get(name));

  if (body.action === 'search') {
    if (!provider) return respond({ code: 'UNSPLASH_NOT_CONFIGURED' }, 503);
    const query = typeof body.query === 'string' ? body.query.trim().slice(0, SEARCH_LIMIT) : '';
    if (!query) return respond({ code: 'SEARCH_QUERY_REQUIRED' }, 422);
    try {
      const photos = await provider.search(query, 6);
      return respond({ photos: photos.map(publicPhoto), provider: provider.name, live: provider.live });
    } catch {
      return respond({ code: 'UNSPLASH_SEARCH_FAILED' }, 502);
    }
  }

  if (body.action === 'use') {
    if (!provider) return respond({ code: 'UNSPLASH_NOT_CONFIGURED' }, 503);
    if (typeof body.photo_id !== 'string' || !ID_PATTERN.test(body.photo_id)) return respond({ code: 'PHOTO_ID_INVALID' }, 422);
    const photo = await provider.getPhoto(body.photo_id).catch(() => null);
    if (!photo) return respond({ code: 'PHOTO_NOT_FOUND' }, 404);
    // Unsplash asks for the download endpoint to be called whenever a photo is used. If it fails, the cover is not saved.
    if (photo.downloadLocation) {
      try { await provider.trackDownload(photo.downloadLocation); } catch { return respond({ code: 'UNSPLASH_DOWNLOAD_TRACK_FAILED' }, 502); }
    }
    const db = serviceClient();
    const chosenAt = new Date().toISOString();
    const { error } = await db.from('mova_artist_profiles').update({
      cover_source: 'unsplash', cover_unsplash_photo_id: photo.id, cover_image_url: photo.imageUrl,
      cover_credit_name: photo.photographerName, cover_credit_url: photo.photographerUrl, cover_unsplash_url: photo.photoUrl, cover_chosen_at: chosenAt,
    }).eq('artist_business_id', actor.businessId);
    if (error) return respond({ code: 'COVER_SAVE_FAILED' }, 500);
    return respond({ cover: { source: 'unsplash', ...publicPhoto(photo), chosen_at: chosenAt } });
  }

  if (body.action === 'clear') {
    const db = serviceClient();
    const { error } = await db.from('mova_artist_profiles').update({
      cover_source: 'upload', cover_unsplash_photo_id: null, cover_image_url: null, cover_credit_name: null, cover_credit_url: null, cover_unsplash_url: null, cover_chosen_at: null,
    }).eq('artist_business_id', actor.businessId);
    return error ? respond({ code: 'COVER_SAVE_FAILED' }, 500) : respond({ cover: { source: 'upload' } });
  }
  return respond({ code: 'ACTION_INVALID' }, 422);
});
