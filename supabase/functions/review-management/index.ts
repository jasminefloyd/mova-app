import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { accessTokenFor, businessProfileReady, googleProvider, loadConnection } from '../_shared/google-connection.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';
import { emailProviderFromEnv, type EmailProvider } from '../_shared/providers/email/index.ts';
import { replyWriterFromEnv } from '../_shared/providers/ai/reply.ts';
import { sendFirstReviewReplyEmail, type ReviewReplyEmailDb } from '../_shared/review-reply-email.ts';

const env = (name: string) => Deno.env.get(name);
/** RV-D1: review-reply emails need their own switch, a live email provider and a real postal address. */
function reviewReplyEmailProvider(): EmailProvider | null {
  if (env('MOVA_EMAIL_REVIEW_REPLIES_ENABLED') !== 'true' || !env('MOVA_EMAIL_POSTAL_ADDRESS')) return null;
  return emailProviderFromEnv(env);
}

Deno.serve(withSystemRequestLogging('review-management', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return respond({ code: 'REQUEST_INVALID' }, 422);
  if (!await platformSwitchEnabled('reviews')) return respond({ code: 'REVIEWS_FEATURE_DISABLED' }, 403);
  const db = serviceClient();
  if (body.action === 'get') {
    const googleEnabled = Deno.env.get('MOVA_GOOGLE_REVIEWS_ENABLED') === 'true' && Deno.env.get('MOVA_PUBLIC_REVIEWS_ENABLED') === 'true';
    const [{ data: reviews, error: reviewsError }, { data: settings, error: settingsError }, { data: google, error: googleError }, { data: summary, error: summaryError }] = await Promise.all([
      actor.client.from('mova_reviews').select('id,rating,tags,body,display_name,locale,moderation_status,artist_reply,artist_replied_at,reply_emailed_at,ai_reply_suggestion,created_at,appointment_id,mova_appointments(service_name_snapshot)').eq('artist_business_id', actor.businessId).order('created_at', { ascending: false }).limit(100),
      actor.client.from('mova_review_settings').select('ask_after_visit,google_review_url').eq('artist_business_id', actor.businessId).maybeSingle(),
      actor.client.from('mova_google_reviews').select('id,rating,body,display_name,provider_created_at,provider_updated_at,reply_body,reply_status,reply_posted_at,ai_reply_suggestion').eq('artist_business_id', actor.businessId).order('provider_created_at', { ascending: false }).limit(100),
      db.rpc('mova_reputation_summary', { p_artist_business_id: actor.businessId, p_include_google: googleEnabled }),
    ]);
    if (reviewsError || settingsError || googleError || summaryError) return respond({ code: 'REVIEWS_READ_FAILED' }, 500);
    // No mail sender is installed in the P11 outbox pipeline. An environment
    // toggle alone must never make review requests appear deliverable.
    return respond({ reviews: reviews ?? [], settings: settings ?? { ask_after_visit: false, google_review_url: null }, google_reviews: googleEnabled ? google ?? [] : [], summary, google_import_enabled: googleEnabled, email_delivery_enabled: false,
      reply_email_enabled: reviewReplyEmailProvider() !== null, ai_reply_available: replyWriterFromEnv(env) !== null });
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
    // RV-D1: only the first reply is emailed. A failed email never undoes the saved reply.
    const emailed = body.reply.trim()
      ? await sendFirstReviewReplyEmail(db as unknown as ReviewReplyEmailDb, reviewReplyEmailProvider(), {
        reviewId: body.review_id, artistBusinessId: actor.businessId, postalAddress: env('MOVA_EMAIL_POSTAL_ADDRESS') ?? null,
        publicBaseUrl: env('MOVA_EMAIL_PUBLIC_BASE_URL') ?? 'https://mova-beauty.co',
      }).catch(() => 'failed' as const)
      : 'off';
    return respond({ saved: true, emailed });
  }
  if (body.action === 'suggest_reply') {
    // RV-D2: one suggestion per review. A stored suggestion is returned as is; there is no regenerate.
    if (typeof body.review_id !== 'string' || !['mova', 'google'].includes(body.source)) return respond({ code: 'REVIEW_SUGGEST_INVALID' }, 422);
    const writer = replyWriterFromEnv(env);
    if (!writer) return respond({ code: 'AI_REPLY_UNAVAILABLE' }, 503);
    const table = body.source === 'google' ? 'mova_google_reviews' : 'mova_reviews';
    const columns = body.source === 'google' ? 'id,rating,body,display_name,ai_reply_suggestion' : 'id,rating,tags,body,display_name,locale,ai_reply_suggestion,mova_appointments(service_name_snapshot)';
    const { data: review } = await db.from(table).select(columns).eq('id', body.review_id).eq('artist_business_id', actor.businessId).maybeSingle();
    if (!review) return respond({ code: 'REVIEW_NOT_FOUND' }, 404);
    const row = review as unknown as { rating: number; tags?: string[]; body: string; display_name: string; locale?: string; ai_reply_suggestion: string | null; mova_appointments?: { service_name_snapshot: string } | null };
    if (row.ai_reply_suggestion) return respond({ suggestion: row.ai_reply_suggestion, reused: true });
    const { data: profile } = await db.from('mova_artist_profiles').select('display_name,preferred_locale').eq('artist_business_id', actor.businessId).maybeSingle();
    const locale = row.locale === 'es-US' || (!row.locale && profile?.preferred_locale === 'es-US') ? 'es-US' : 'en-US';
    let suggestion;
    try {
      suggestion = await writer.suggest({ businessName: String(profile?.display_name ?? ''), reviewerName: row.display_name ?? '', rating: Number(row.rating), tags: row.tags ?? [], body: row.body ?? '', serviceName: row.mova_appointments?.service_name_snapshot ?? null, source: body.source, locale });
    } catch { return respond({ code: 'AI_REPLY_FAILED' }, 502); }
    // Stored only if none exists yet, so two taps can't produce two different suggestions.
    const { data: stored } = await db.from(table).update({ ai_reply_suggestion: suggestion.text, ai_reply_suggested_at: new Date().toISOString(), ai_reply_model: suggestion.servedBy })
      .eq('id', body.review_id).eq('artist_business_id', actor.businessId).is('ai_reply_suggestion', null).select('ai_reply_suggestion').maybeSingle();
    if (!stored) {
      const { data: again } = await db.from(table).select('ai_reply_suggestion').eq('id', body.review_id).eq('artist_business_id', actor.businessId).maybeSingle();
      return respond({ suggestion: (again as { ai_reply_suggestion?: string } | null)?.ai_reply_suggestion ?? suggestion.text, reused: true });
    }
    return respond({ suggestion: suggestion.text, reused: false });
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
    if (isReply && (!text || text.length > 4096)) return respond({ code: 'REVIEW_REPLY_INVALID' }, 422);
    const provider = googleProvider(request);
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
}));
