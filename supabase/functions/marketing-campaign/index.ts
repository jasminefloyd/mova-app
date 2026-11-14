import { withSystemRequestLogging, writeSystemLog } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';
import { platformSwitchEnabled } from '../_shared/platform-switch.ts';

const channelSpec = {
  email: { feature: 'marketing_email', platform: 'marketing_email', provider: 'resend' },
  social: { feature: 'marketing_social', platform: 'marketing_social', provider: null },
  web_push: { feature: 'marketing_web_push', platform: 'marketing_web_push', provider: 'web_push' },
  wallet: { feature: 'marketing_wallet', platform: 'marketing_wallet', provider: null },
} as const;
type Channel = keyof typeof channelSpec;
const validChannel = (value: unknown): value is Channel => typeof value === 'string' && value in channelSpec;
const validGoal = (value: unknown) => ['fill_opening','rebook','offer','showcase'].includes(String(value));
const bounded = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// Audience segments are fixed choices from the product decision (Nov 13). Each one narrows the consented audience.
const segments = ['consented_clients', 'lapsed_60', 'recent_90', 'upcoming'] as const;
type Segment = typeof segments[number];
const validSegment = (value: unknown): value is Segment => typeof value === 'string' && (segments as readonly string[]).includes(value);
const DAY_MS = 86_400_000;
const APPOINTMENT_READ_LIMIT = 5000;

/**
 * Narrows consented client ids to a segment using appointment history.
 * lapsed_60: last confirmed or completed visit more than 60 days ago, with no upcoming booking.
 * recent_90: a confirmed or completed visit in the last 90 days.
 * upcoming: at least one confirmed booking in the future.
 * Throws AUDIENCE_TOO_LARGE rather than guessing when history exceeds the read limit.
 */
async function segmentClientIds(db: ReturnType<typeof serviceClient>, businessId: string, segment: Segment, candidateIds: string[], now: number) {
  if (segment === 'consented_clients' || candidateIds.length === 0) return candidateIds;
  const nowIso = new Date(now).toISOString();
  const { data: upcoming, error: upcomingError } = await db.from('mova_appointments').select('client_id')
    .eq('artist_business_id', businessId).eq('status', 'confirmed').gt('starts_at', nowIso).not('client_id', 'is', null).limit(APPOINTMENT_READ_LIMIT);
  if (upcomingError) throw new Error('AUDIENCE_PREVIEW_FAILED');
  if ((upcoming ?? []).length >= APPOINTMENT_READ_LIMIT) throw new Error('AUDIENCE_TOO_LARGE');
  const { data: past, error: pastError } = await db.from('mova_appointments').select('client_id,starts_at')
    .eq('artist_business_id', businessId).in('status', ['confirmed', 'completed']).lte('starts_at', nowIso)
    .gte('starts_at', new Date(now - 730 * DAY_MS).toISOString()).not('client_id', 'is', null)
    .order('starts_at', { ascending: false }).limit(APPOINTMENT_READ_LIMIT);
  if (pastError) throw new Error('AUDIENCE_PREVIEW_FAILED');
  if ((past ?? []).length >= APPOINTMENT_READ_LIMIT) throw new Error('AUDIENCE_TOO_LARGE');
  const upcomingIds = new Set((upcoming ?? []).map((row) => row.client_id as string));
  const lastVisit = new Map<string, number>();
  for (const row of past ?? []) {
    const id = row.client_id as string;
    const time = Date.parse(row.starts_at as string);
    if (!lastVisit.has(id) || time > (lastVisit.get(id) ?? 0)) lastVisit.set(id, time);
  }
  const candidates = new Set(candidateIds);
  if (segment === 'upcoming') return candidateIds.filter((id) => upcomingIds.has(id));
  if (segment === 'recent_90') return [...lastVisit].filter(([id, time]) => candidates.has(id) && time >= now - 90 * DAY_MS).map(([id]) => id);
  return [...lastVisit].filter(([id, time]) => candidates.has(id) && time < now - 60 * DAY_MS && !upcomingIds.has(id)).map(([id]) => id);
}

Deno.serve(withSystemRequestLogging('marketing-campaign', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return respond({ code: 'INVALID_REQUEST' }, 422);
  const db = serviceClient();

  if (body.action === 'status') {
    const { data: campaigns, error } = await db.from('mova_marketing_campaigns')
      .select('id,name,goal,status,scheduled_at,created_at,updated_at,mova_marketing_campaign_channels(channel,status,error_code)')
      .eq('artist_business_id', actor.businessId).order('created_at', { ascending: false }).limit(50);
    if (error) return respond({ code: 'CAMPAIGN_READ_FAILED' }, 500);
    const channels = {} as Record<Channel, { plan: boolean; platform: boolean; ready: boolean }>;
    for (const channel of Object.keys(channelSpec) as Channel[]) {
      const spec = channelSpec[channel];
      const plan = await planFeatureEnabled(actor.businessId, spec.feature);
      const platform = await platformSwitchEnabled(spec.platform);
      channels[channel] = { plan, platform, ready: false };
    }
    return respond({ campaigns: campaigns ?? [], channels, sms_supported: false, delivery_enabled: false });
  }

  if (body.action === 'preview') {
    if (!validChannel(body.channel)) return respond({ code: 'INVALID_CHANNEL' }, 422);
    if (!await planFeatureEnabled(actor.businessId, channelSpec[body.channel].feature)) return respond({ code: 'CHANNEL_NOT_IN_PLAN' }, 403);
    const platform = await platformSwitchEnabled(channelSpec[body.channel].platform);
    if (body.channel === 'social') return respond({ channel: body.channel, eligible: null, audience: 'Public followers', ready: false, reason: 'SOCIAL_CONNECTION_NOT_CONFIGURED' });
    if (body.channel === 'wallet') return respond({ channel: body.channel, eligible: null, audience: 'Clients with an eligible saved pass', ready: false, reason: 'WALLET_PROVIDER_NOT_CONFIGURED' });
    const purpose = body.goal === 'rebook' ? 'rebooking_reminders' : 'offers';
    const consentChannel = body.channel === 'web_push' ? 'push' : 'email';
    const { data: clients, error } = await db.from('mova_clients').select('id,email_normalized,marketing_opted_out')
      .eq('artist_business_id', actor.businessId).eq('marketing_opted_out', false).limit(500);
    if (error) return respond({ code: 'AUDIENCE_PREVIEW_FAILED' }, 500);
    const { data: links, error: linksError } = await db.from('mova_client_customer_links').select('client_id,customer_account_id').eq('artist_business_id', actor.businessId).is('unlinked_at', null);
    if (linksError) return respond({ code: 'AUDIENCE_PREVIEW_FAILED' }, 500);
    const linkedAccounts = [...new Set((links ?? []).map((link) => link.customer_account_id))];
    const { data: clientOverrides, error: overridesError } = linkedAccounts.length ? await db.from('mova_client_feature_overrides').select('customer_account_id')
      .eq('artist_business_id', actor.businessId).eq('feature_key', channelSpec[body.channel].feature).eq('enabled', false).in('customer_account_id', linkedAccounts) : { data: [], error: null };
    if (overridesError) return respond({ code: 'AUDIENCE_PREVIEW_FAILED' }, 500);
    const disabledAccounts = new Set((clientOverrides ?? []).map((override) => override.customer_account_id));
    const disabledClientIds = new Set((links ?? []).filter((link) => disabledAccounts.has(link.customer_account_id)).map((link) => link.client_id));
    const ids = (clients ?? []).filter((c) => !disabledClientIds.has(c.id) && (body.channel !== 'email' || Boolean(c.email_normalized))).map((c) => c.id);
    let pushEligibleClientIds: Set<string> | null = null;
    if (body.channel === 'web_push') {
      const accountIds = [...new Set((links ?? []).map((link) => link.customer_account_id))];
      const { data: accounts, error: accountsError } = accountIds.length ? await db.from('mova_customer_accounts').select('id,user_id').in('id', accountIds) : { data: [], error: null };
      if (accountsError) return respond({ code: 'AUDIENCE_PREVIEW_FAILED' }, 500);
      const userIds = (accounts ?? []).map((account) => account.user_id);
      const { data: subscriptions, error: subscriptionsError } = userIds.length ? await db.from('mova_push_subscriptions').select('user_id').eq('artist_business_id', actor.businessId).is('revoked_at', null).in('user_id', userIds) : { data: [], error: null };
      if (subscriptionsError) return respond({ code: 'AUDIENCE_PREVIEW_FAILED' }, 500);
      const activeUsers = new Set((subscriptions ?? []).map((subscription) => subscription.user_id));
      const userByAccount = new Map((accounts ?? []).map((account) => [account.id, account.user_id]));
      pushEligibleClientIds = new Set((links ?? []).filter((link) => activeUsers.has(userByAccount.get(link.customer_account_id))).map((link) => link.client_id));
    }
    const candidateIds = pushEligibleClientIds ? ids.filter((id) => pushEligibleClientIds?.has(id)) : ids;
    const segment: Segment = validSegment(body.segment) ? body.segment : 'consented_clients';
    let audienceIds: string[];
    try {
      audienceIds = await segmentClientIds(db, actor.businessId, segment, candidateIds, Date.now());
    } catch (segmentError) {
      return respond({ code: segmentError instanceof Error && segmentError.message === 'AUDIENCE_TOO_LARGE' ? 'AUDIENCE_TOO_LARGE' : 'AUDIENCE_PREVIEW_FAILED' }, segmentError instanceof Error && segmentError.message === 'AUDIENCE_TOO_LARGE' ? 409 : 500);
    }
    const { data: eligible, error: eligibilityError } = await db.rpc('mova_marketing_eligible_count', {
      p_artist_business_id: actor.businessId, p_client_ids: audienceIds, p_channel: consentChannel, p_purpose: purpose,
    });
    if (eligibilityError) return respond({ code: 'AUDIENCE_PREVIEW_FAILED' }, 500);
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'marketing.audience.previewed', requestId: request.headers.get('x-request-id'), userId: actor.user.id, artistBusinessId: actor.businessId, message: 'Marketing audience eligibility previewed', context: { action: 'preview', result_count: eligible } });
    const reason = !platform ? 'CHANNEL_ROLLOUT_DISABLED' : eligible === 0 ? 'NO_CONSENTED_RECIPIENTS' : body.channel === 'email' ? 'EMAIL_DELIVERY_NOT_CONFIGURED' : 'PUSH_DELIVERY_NOT_CONFIGURED';
    return respond({ channel: body.channel, segment, eligible, considered: audienceIds.length, capped: ids.length === 500,
      audience: body.channel === 'email' ? 'Clients with email consent' : 'Clients with push consent', ready: false, reason });
  }

  if (body.action === 'save') {
    if (!bounded(body.name, 120) || !validGoal(body.goal) || !Array.isArray(body.channels) || !body.channels.length || body.channels.some((item: unknown) => !item || typeof item !== 'object' || !validChannel((item as Record<string, unknown>).channel))) return respond({ code: 'CAMPAIGN_VALIDATION_FAILED' }, 422);
    const name = body.name.trim();
    const channels = body.channels as Array<{ channel: Channel; content: Record<string, unknown> }>;
    for (const item of channels) {
      if (!await planFeatureEnabled(actor.businessId, channelSpec[item.channel].feature)) return respond({ code: 'CHANNEL_NOT_IN_PLAN' }, 403);
      const content = item.content;
      if (!content || typeof content !== 'object' || Array.isArray(content) || Object.keys(content).some((key) => !['subject','text','cta','url','social_captions','social_destinations','image_url','scheduled_local','time_zone'].includes(key))) return respond({ code: 'CAMPAIGN_CONTENT_INVALID' }, 422);
      if (Object.values(content).some((value) => typeof value === 'string' && value.length > 5000)) return respond({ code: 'CAMPAIGN_CONTENT_INVALID' }, 422);
      if (item.channel === 'email' && (!bounded(content.subject, 160) || !bounded(content.text, 5000))) return respond({ code: 'CAMPAIGN_CONTENT_INVALID' }, 422);
      if (item.channel === 'social') {
        if (!content.social_captions || typeof content.social_captions !== 'object' || Array.isArray(content.social_captions) || !Array.isArray(content.social_destinations) || content.social_destinations.length < 1) return respond({ code: 'CAMPAIGN_CONTENT_INVALID' }, 422);
        const destinations = content.social_destinations as unknown[];
        const captions = content.social_captions as Record<string, unknown>;
        if (destinations.some((destination) => !['instagram','facebook','google_business'].includes(String(destination))) || Object.keys(captions).some((destination) => !['instagram','facebook','google_business'].includes(destination)) || destinations.some((destination) => !bounded(captions[String(destination)],2200))) return respond({ code: 'CAMPAIGN_CONTENT_INVALID' }, 422);
      }
    }
    if (body.audience !== undefined && (!body.audience || typeof body.audience !== 'object' || Array.isArray(body.audience) || Object.keys(body.audience).some((key) => !['segment','service_id','location_id'].includes(key)) || Object.values(body.audience).some((value) => typeof value !== 'string' || value.length > 100))) return respond({ code: 'CAMPAIGN_AUDIENCE_INVALID' }, 422);
    if (body.audience?.segment !== undefined && !validSegment(body.audience.segment)) return respond({ code: 'CAMPAIGN_AUDIENCE_INVALID' }, 422);
    const audience = body.audience && typeof body.audience === 'object' ? body.audience : {};
    const rows = channels.map((item) => ({ artist_business_id: actor.businessId,
      channel: item.channel, provider: channelSpec[item.channel].provider, content: item.content, status: 'draft' }));
    if (typeof body.id === 'string') {
      // Editing a saved draft replaces its fields and channel content. Anything already sent or scheduled is read-only.
      const { data: existing, error: existingError } = await db.from('mova_marketing_campaigns').update({
        name, goal: body.goal, audience, updated_at: new Date().toISOString(),
      }).eq('artist_business_id', actor.businessId).eq('id', body.id).eq('status', 'draft').select('id,name,goal,status,created_at').maybeSingle();
      if (existingError || !existing) return respond({ code: 'CAMPAIGN_NOT_EDITABLE' }, 409);
      const { error: deleteError } = await db.from('mova_marketing_campaign_channels').delete().eq('campaign_id', existing.id).eq('artist_business_id', actor.businessId);
      if (deleteError) return respond({ code: 'CAMPAIGN_SAVE_FAILED' }, 500);
      const { error: replaceError } = await db.from('mova_marketing_campaign_channels').insert(rows.map((row) => ({ ...row, campaign_id: existing.id })));
      if (replaceError) return respond({ code: 'CAMPAIGN_SAVE_FAILED' }, 500);
      await writeSystemLog({ level: 'info', source: 'function', eventName: 'marketing.campaign.draft_updated', requestId: request.headers.get('x-request-id'), userId: actor.user.id, artistBusinessId: actor.businessId, message: 'Marketing campaign draft updated' });
      return respond({ campaign: existing });
    }
    const { data: campaign, error } = await db.from('mova_marketing_campaigns').insert({
      artist_business_id: actor.businessId, created_by: actor.user.id, name, goal: body.goal,
      audience, status: 'draft',
    }).select('id,name,goal,status,created_at').single();
    if (error || !campaign) return respond({ code: 'CAMPAIGN_SAVE_FAILED' }, 500);
    const insertRows = rows.map((row) => ({ ...row, campaign_id: campaign.id }));
    const { error: channelError } = await db.from('mova_marketing_campaign_channels').insert(insertRows);
    if (channelError) { await db.from('mova_marketing_campaigns').delete().eq('id', campaign.id).eq('artist_business_id', actor.businessId); return respond({ code: 'CAMPAIGN_SAVE_FAILED' }, 500); }
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'marketing.campaign.draft_created', requestId: request.headers.get('x-request-id'), userId: actor.user.id, artistBusinessId: actor.businessId, message: 'Marketing campaign draft created', context: { action: 'create', outcome: 'draft' } });
    return respond({ campaign });
  }

  if (body.action === 'get') {
    if (typeof body.id !== 'string') return respond({ code: 'CAMPAIGN_ID_REQUIRED' }, 422);
    const { data: campaign, error } = await db.from('mova_marketing_campaigns')
      .select('id,name,goal,status,audience,created_at,mova_marketing_campaign_channels(channel,content,status)')
      .eq('artist_business_id', actor.businessId).eq('id', body.id).maybeSingle();
    if (error || !campaign) return respond({ code: 'CAMPAIGN_NOT_FOUND' }, 404);
    return respond({ campaign });
  }

  if (body.action === 'schedule' || body.action === 'send') {
    await writeSystemLog({ level: 'warning', source: 'function', eventName: 'marketing.delivery.blocked', requestId: request.headers.get('x-request-id'), userId: actor.user.id, artistBusinessId: actor.businessId, errorCode: 'MARKETING_DELIVERY_NOT_CONFIGURED', message: 'Marketing delivery is blocked because provider adapters are not enabled', context: { action: String(body.action), outcome: 'blocked' } });
    return respond({ code: 'MARKETING_DELIVERY_NOT_CONFIGURED', delivery_enabled: false }, 409);
  }
  if (body.action === 'cancel') {
    if (typeof body.id !== 'string') return respond({ code: 'CAMPAIGN_ID_REQUIRED' }, 422);
    const { data, error } = await db.from('mova_marketing_campaigns').update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('artist_business_id', actor.businessId).eq('id', body.id).in('status', ['draft','scheduled']).select('id,status').maybeSingle();
    if (error || !data) return respond({ code: 'CAMPAIGN_CANCEL_FAILED' }, 409);
    await writeSystemLog({ level: 'info', source: 'function', eventName: 'marketing.campaign.cancelled', requestId: request.headers.get('x-request-id'), userId: actor.user.id, artistBusinessId: actor.businessId, message: 'Marketing campaign draft cancelled', context: { action: 'cancel', outcome: 'cancelled' } });
    return respond({ campaign: data });
  }
  return respond({ code: 'INVALID_ACTION' }, 422);
}));
