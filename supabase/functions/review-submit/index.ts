import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient, tokenHash } from '../_shared/booking.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';

Deno.serve(withSystemRequestLogging('review-submit', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!await platformSwitchEnabled('reviews')) return respond({ code: 'REVIEWS_FEATURE_DISABLED' }, 503);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.token !== 'string' || body.token.length < 32 || body.token.length > 128
    || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5
    || !Array.isArray(body.tags) || body.tags.length > 5
    || !body.tags.every((tag: unknown) => ['great_results', 'listened_to_me', 'on_time', 'clean_space', 'healthy_hair'].includes(String(tag)))
    || typeof body.comment !== 'string' || body.comment.length > 1000
    || !['en-US', 'es-US'].includes(body.locale)) return respond({ code: 'REVIEW_INPUT_INVALID' }, 422);
  const { data, error } = await serviceClient().rpc('mova_review_submit', {
    p_token_hash: await tokenHash(body.token),
    p_rating: body.rating,
    p_tags: body.tags,
    p_body: body.comment,
    p_locale: body.locale,
  });
  if (error) return respond({ code: error.message || 'REVIEW_SUBMISSION_FAILED' }, error.code === '23505' ? 409 : error.code === 'P0002' ? 404 : 422);
  return respond(data);
}));
