import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient, tokenHash } from '../_shared/booking.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';
Deno.serve(withSystemRequestLogging('review-public-context', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!await platformSwitchEnabled('reviews')) return respond({ code: 'REVIEWS_FEATURE_DISABLED' }, 503);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.token !== 'string' || body.token.length < 32 || body.token.length > 128) return respond({ code: 'REVIEW_LINK_INVALID' }, 404);
  const { data, error } = await serviceClient().rpc('mova_review_public_context', { p_token_hash: await tokenHash(body.token) });
  if (error) return respond({ code: 'REVIEW_CONTEXT_UNAVAILABLE' }, 500);
  if (!data) return respond({ code: 'REVIEW_LINK_INVALID' }, 404);
  const context = { ...data } as Record<string, unknown>;
  const photoPath = context.profile_photo_path;
  delete context.profile_photo_path;
  if (typeof photoPath === 'string' && photoPath) {
    const { data: photo } = await serviceClient().storage.from('mova_profile_photos').createSignedUrl(photoPath, 300);
    if (photo?.signedUrl) context.artist_photo_url = photo.signedUrl;
  }
  return respond(context);
}));
