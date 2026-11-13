import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { deviceFromUserAgent, HOURLY_LIMIT, parseFeedback, SCREENSHOT_MAX_BYTES, SCREENSHOT_TYPES } from './rules.ts';

// Task 3.5: writes a stylist's feedback to mova_support_messages through the stylist's own client,
// so RLS decides what they may insert. Screenshots go to a private bucket via a signed upload URL.
// Never attaches client data: only what the stylist typed, the screen path, device and app version.
const BUCKET = 'mova_support_screenshots';

Deno.serve(withSystemRequestLogging('support-feedback', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Number(request.headers.get('content-length') ?? '0') > 16384) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await actor.client.from('mova_support_messages').select('id', { count: 'exact', head: true }).gte('created_at', since);
  if (countError) return respond({ code: 'FEEDBACK_UNAVAILABLE' }, 503);
  if ((count ?? 0) >= HOURLY_LIMIT) return respond({ code: 'FEEDBACK_RATE_LIMITED' }, 429);

  if (body?.action === 'upload-url') {
    const ext = SCREENSHOT_TYPES[String(body.content_type)];
    const size = Number(body.size);
    if (!ext || !Number.isFinite(size) || size <= 0 || size > SCREENSHOT_MAX_BYTES) return respond({ code: 'FEEDBACK_SCREENSHOT_INVALID' }, 422);
    const path = `${actor.businessId}/${actor.user.id}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await serviceClient().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return respond({ code: 'FEEDBACK_UPLOAD_UNAVAILABLE' }, 503);
    return respond({ bucket: BUCKET, path, token: data.token });
  }

  if (body?.action !== 'submit') return respond({ code: 'INVALID_ACTION' }, 422);
  const parsed = parseFeedback(body, actor.businessId, actor.user.id);
  if ('code' in parsed) return respond(parsed, 422);
  const { data, error } = await actor.client.from('mova_support_messages').insert({
    artist_business_id: actor.businessId,
    user_id: actor.user.id,
    ...parsed,
    device: deviceFromUserAgent(request.headers.get('user-agent')),
  }).select('id,created_at').single();
  if (error || !data) return respond({ code: 'FEEDBACK_SAVE_FAILED' }, 500);
  return respond({ id: data.id, created_at: data.created_at, reply_to: actor.user.email ?? null });
}));
