import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { accessTokenFor, businessProfileReady, googleProvider, loadConnection } from '../_shared/google-connection.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return respond({ code: 'REQUEST_INVALID' }, 422);
  const db = serviceClient();
  if (body.action === 'get') {
    const googleEnabled = Deno.env.get('MOVA_GOOGLE_REVIEWS_ENABLED') === 'true' && Deno.env.get('MOVA_PUBLIC_REVIEWS_ENABLED') === 'true';
    const [{ data: reviews, error: reviewsError }, { data: settings, error: settingsError }, { data: google, error: googleError }, { data: summary, error: summaryError }] = await Promise.all([
      actor.client.from('mova_reviews').select('id,rating,tags,body,display_name,locale,moderation_status,artist_reply,artist_replied_at,created_at,appointment_id,mova_appointments(service_name_snapshot)').eq('artist_business_id', actor.businessId).order('created_at', { ascending: false }).limit(100),
      actor.client.from('mova_review_settings').select('ask_after_visit,google_review_url').eq('artist_business_id', actor.businessId).maybeSingle(),
      actor.client.from('mova_google_reviews').select('id,rating,body,display_name,provider_created_at,provider_updated_at,reply_body,reply_status,reply_posted_at').eq('artist_business_id', actor.businessId).order('provider_created_at', { ascending: false }).limit(100),
      db.rpc('mova_reputation_summary', { p_artist_business_id: actor.businessId, p_include_google: googleEnabled }),
    ]);
    if (reviewsError || settingsError || googleError || summaryError) return respond({ code: 'REVIEWS_READ_FAILED' }, 500);
    // No mail sender is installed in the P11 outbox pipeline. An environment
    // toggle alone must never make review requests appear deliverable.
    return respond({ reviews: reviews ?? [], settings: settings ?? { ask_after_visit: false, google_review_url: null }, google_reviews: googleEnabled ? google ?? [] : [], summary, google_import_enabled: googleEnabled, email_delivery_enabled: false });
  }
  if (body.action === 'save_settings') {
    if (typeof body.ask_after_visit !== 'boolean' || !(body.google_review_url === null || typeof body.google_review_url === 'string')) return respond({ code: 'REVIEW_SETTINGS_INVALID' }, 422);
    if (body.ask_after_visit) return respond({ code: 'REVIEW_EMAIL_PROVIDER_UNAVAILABLE' }, 409);
    const { data, error } = await db.rpc('mova_review_settings_save', {
      p_artist_business_id: actor.businessId,
      p_ask_after_visit: body.ask_after_visit,
      p_google_review_url: body.google_review_url,
      p_actor_id: actor.user.id,
    });
    if (error) return respond({ code: error.message || 'REVIEW_SETTINGS_SAVE_FAILED' }, 422);
    return respond(data);
  }
  if (body.action === 'reply') {
    if (typeof body.review_id !== 'string' || typeof body.reply !== 'string' || body.reply.length > 2000) return respond({ code: 'REVIEW_REPLY_INVALID' }, 422);
    const { error } = await db.rpc('mova_review_reply_save', { p_review_id: body.review_id, p_artist_business_id: actor.businessId, p_reply: body.reply, p_actor_id: actor.user.id });
    if (error) return respond({ code: error.message || 'REVIEW_REPLY_SAVE_FAILED' }, 422);
    return respond({ saved: true });
  }
  if (body.action === 'report') {
    if (typeof body.review_id !== 'string' || typeof body.reason !== 'string' || typeof body.details !== 'string') return respond({ code: 'REVIEW_REPORT_INVALID' }, 422);
    const { data, error } = await db.rpc('mova_review_report_create', { p_review_id: body.review_id, p_artist_business_id: actor.businessId, p_reason: body.reason, p_details: body.details, p_actor_id: actor.user.id });
    if (error) return respond({ code: error.message || 'REVIEW_REPORT_FAILED' }, 422);
    return respond({ report_id: data, queued_for_platform_review: true });
  }
  if (body.action === 'reply_google' || body.action === 'delete_google_reply') {
    // Replies to Google reviews are posted through the one Google connection. Nothing is saved as posted
    // until Google accepts it, and nothing changes at all when Google is not configured.
    if (typeof body.review_id !== 'string') return respond({ code: 'REVIEW_REPLY_INVALID' }, 422);
    const isReply = body.action === 'reply_google';
    const text = isReply && typeof body.reply === 'string' ? body.reply.trim() : null;
    if (isReply && (!text || text.length > 2000)) return respond({ code: 'REVIEW_REPLY_INVALID' }, 422);
    const provider = googleProvider();
    if (!provider) return respond({ code: 'GOOGLE_NOT_CONFIGURED' }, 503);
    const connection = await loadConnection(db, actor.businessId).catch(() => null);
    if (!businessProfileReady(connection)) return respond({ code: 'GOOGLE_NOT_CONNECTED' }, 409);
    const { data: review } = await db.from('mova_google_reviews').select('id,provider_review_id,reply_status').eq('id', body.review_id).eq('artist_business_id', actor.businessId).maybeSingle();
    if (!review) return respond({ code: 'REVIEW_NOT_FOUND' }, 404);
    const locationId = connection.business_location_id!;
    if (!isReply) {
      try {
        await provider.deleteReviewReply(await accessTokenFor(provider, connection), locationId, review.provider_review_id);
      } catch { return respond({ code: 'GOOGLE_REPLY_DELETE_FAILED' }, 502); }
      await db.from('mova_google_reviews').update({ reply_body: null, reply_status: 'none', reply_posted_at: null, reply_updated_at: new Date().toISOString() }).eq('id', review.id);
      return respond({ deleted: true });
    }
    const now = new Date().toISOString();
    await db.from('mova_google_reviews').update({ reply_body: text, reply_status: 'queued', reply_updated_at: now }).eq('id', review.id);
    try {
      await provider.replyToReview(await accessTokenFor(provider, connection), locationId, review.provider_review_id, text!);
    } catch {
      await db.from('mova_google_reviews').update({ reply_status: 'failed', reply_updated_at: new Date().toISOString() }).eq('id', review.id);
      return respond({ code: 'GOOGLE_REPLY_FAILED', reply_status: 'failed' }, 502);
    }
    await db.from('mova_google_reviews').update({ reply_status: 'posted', reply_posted_at: new Date().toISOString() }).eq('id', review.id);
    return respond({ saved: true, reply_status: 'posted' });
  }
  return respond({ code: 'ACTION_INVALID' }, 422);
});
