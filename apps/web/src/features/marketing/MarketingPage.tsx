import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button, Card, EmptyState, ErrorState, Icon, OfflineBanner, ScreenHeader, Sheet, StatusChip, TextArea, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { LockCard } from '../billing/PlanGate';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import './marketing.css';

type Channel = 'email' | 'social' | 'web_push' | 'wallet';
type Goal = 'fill_opening' | 'rebook' | 'rebooking_reminder' | 'offer' | 'showcase' | 'other';
type Segment = 'booked_service' | 'recent_180' | 'consented_clients' | 'lapsed_60' | 'due_rebook';
type Campaign = { id: string; name: string; goal: string; status: string; created_at: string; scheduled_at?: string | null; mova_marketing_campaign_channels?: Array<{ channel: Channel; status: string; error_code: string | null }> };
type ChannelGate = { plan: boolean; platform: boolean; ready: boolean };
type Status = { campaigns: Campaign[]; channels: Record<Channel, ChannelGate>; delivery_enabled: boolean };
type SampleClient = { id: string; display_name: string; last_visit_at: string | null };
type Preview = { eligible: number | null; considered?: number; capped?: boolean; ready: boolean; reason: string | null; sample_clients?: SampleClient[] };
type Opening = { id: string; starts_at: string; service_name_snapshot: string; location_name: string; service_id: string; location_id: string };
type DraftCampaign = { id: string; name: string; goal: string; audience?: { segment?: string; service_id?: string; location_id?: string }; mova_marketing_campaign_channels?: Array<{ channel: Channel; content: Record<string, unknown> }> };

const channels: Channel[] = ['email', 'social', 'web_push', 'wallet'];
const goalOptions: Array<{ id: Goal; icon: string }> = [
  { id: 'fill_opening', icon: '📅' },
  { id: 'rebook', icon: '↶' },
  { id: 'rebooking_reminder', icon: '↻' },
  { id: 'offer', icon: '✂' },
  { id: 'showcase', icon: '✦' },
  { id: 'other', icon: '✦' },
];
const channelIcon: Record<Channel, string> = { email: '✉', social: '◎', web_push: '🔔', wallet: '▣' };

const call = async <T,>(client: ReturnType<typeof useArtistBusiness>['client'], businessId: string, body: Record<string, unknown>) => {
  if (!client) throw new Error('IDENTITY_REQUIRED');
  const { data, error } = await client.functions.invoke<{ data?: T }>('marketing-campaign', { body, headers: { 'x-mova-artist-business-id': businessId } });
  if (error || !data?.data) throw new Error('MARKETING_ACTION_FAILED');
  return data.data;
};

function localDateTime(value: string, locale: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function MarketingPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<'home' | 'ideas' | 'channels' | 'campaign'>('home');
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [goal, setGoal] = useState<Goal>('fill_opening');
  const [segment, setSegment] = useState<Segment>('booked_service');
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Channel[]>(['email']);
  const [subject, setSubject] = useState('A time just opened up');
  const [copy, setCopy] = useState('Hi {first name}, I had a cancellation and have an opening this week. Want it? Book here and it’s yours.');
  const [captions, setCaptions] = useState<Record<string, string>>({ instagram: 'A time just opened up. Book your next visit with me.', facebook: 'A time just opened up. Book your next visit with me.', google_business: 'A time just opened up. Book your next visit with me.' });
  const [socialDestinations, setSocialDestinations] = useState<string[]>(['instagram']);
  const [previews, setPreviews] = useState<Partial<Record<Channel, Preview>>>({});
  const [messageChannel, setMessageChannel] = useState<'email' | 'social'>('email');
  const [audienceCounts, setAudienceCounts] = useState<Partial<Record<Segment, number | null>>>({});
  const [homeCounts, setHomeCounts] = useState<Partial<Record<'opening' | 'winback' | 'rebooking', number | null>>>({});
  const [clientSheet, setClientSheet] = useState(false);
  const [openingSheet, setOpeningSheet] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState('');

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true); setFailed(false);
    try {
      const [nextStatus, openingResult, businessResult] = await Promise.all([
        call<Status>(client, businessId, { action: 'status' }),
        client.from('mova_appointments').select('id,starts_at,service_name_snapshot,service_id,location_id,mova_locations(name)')
          .eq('artist_business_id', businessId).eq('status', 'cancelled').gt('starts_at', new Date().toISOString()).order('starts_at').limit(12),
        client.from('mova_artist_businesses').select('name').eq('id', businessId).maybeSingle(),
      ]);
      if (openingResult.error || businessResult.error) throw openingResult.error ?? businessResult.error;
      setStatus(nextStatus);
      setBusinessName(businessResult.data?.name ?? '');
      setOpenings((openingResult.data ?? []).map((row: { id: string; starts_at: string; service_name_snapshot: string; service_id: string; location_id: string; mova_locations?: unknown }) => ({ id: row.id, starts_at: row.starts_at, service_name_snapshot: row.service_name_snapshot, service_id: row.service_id, location_id: row.location_id, location_name: (Array.isArray(row.mova_locations) ? row.mova_locations[0] : row.mova_locations as { name?: string } | null)?.name ?? '' })));
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [client, businessId]);

  useEffect(() => { if (!identityLoading && businessId) void load(); }, [identityLoading, businessId, load]);
  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);

  const campaignAvailable = Boolean(status && channels.some((channel) => status.channels[channel].plan));
  const activePreviewChannel = selected.find((channel) => (channel === 'email' || channel === 'web_push') && status?.channels[channel].plan)
    ?? channels.find((channel) => (channel === 'email' || channel === 'web_push') && status?.channels[channel].plan)
    ?? 'email';
  const selectedPreview = previews[activePreviewChannel];
  const eligibleCount = selectedPreview?.eligible ?? null;
  const goalLabel = t(`marketing.goalName.${goal}`, { defaultValue: t('marketing.goalName.fill_opening') });
  const channelTitle = (channel: Channel) => t(`marketing.channel.${channel}`, { defaultValue: channel === 'social' ? 'Instagram & Facebook' : channel === 'web_push' ? 'Web push' : channel[0]!.toUpperCase() + channel.slice(1) });

  const previewChannel = async (channel: Channel, targetSegment: Segment, targetGoal: Goal = goal, targetServiceId: string | null = serviceId) => {
    if (!businessId) return null;
    return call<Preview>(client, businessId, { action: 'preview', channel, goal: targetGoal === 'other' ? 'offer' : targetGoal, segment: targetSegment, ...(targetServiceId ? { service_id: targetServiceId } : {}) });
  };

  useEffect(() => {
    if (!status || !campaignAvailable) return;
    const channel: Channel | null = status.channels.email.plan ? 'email' : status.channels.web_push.plan ? 'web_push' : null;
    if (!channel) { setHomeCounts({}); return; }
    let current = true;
    const tasks: Array<Promise<readonly ['opening' | 'winback' | 'rebooking', number | null]>> = [
      previewChannel(channel, 'lapsed_60', 'rebook').then((value) => ['winback', value?.eligible ?? null] as const),
      previewChannel(channel, 'due_rebook', 'rebooking_reminder').then((value) => ['rebooking', value?.eligible ?? null] as const),
    ];
    if (openings[0]) tasks.push(previewChannel(channel, 'booked_service', 'fill_opening', openings[0].service_id).then((value) => ['opening', value?.eligible ?? null] as const));
    void Promise.all(tasks).then((rows) => { if (current) setHomeCounts(Object.fromEntries(rows) as Partial<Record<'opening' | 'winback' | 'rebooking', number | null>>); })
      .catch(() => { if (current) setHomeCounts({}); });
    return () => { current = false; };
  // Counts on the landing page are fetched from the same consent-aware preview as the wizard.
  }, [status, openings, campaignAvailable, businessId]);

  const loadAudience = async () => {
    if (!businessId || !status) return;
    setBusy(true); setMessage('');
    const channel = selected.find((item) => status.channels[item].plan && (item === 'email' || item === 'web_push')) ?? (status.channels.email.plan ? 'email' : 'web_push');
    try {
      const choices = segmentsForGoal(goal).filter((option) => option !== 'booked_service' || Boolean(serviceId));
      const results = await Promise.all(choices.map(async (option) => [option, await previewChannel(channel, option)] as const));
      setAudienceCounts(Object.fromEntries(results.map(([option, result]) => [option, result?.eligible ?? null])) as Partial<Record<Segment, number | null>>);
      const result = results.find(([option]) => option === segment)?.[1];
      if (result) setPreviews((current) => ({ ...current, [channel]: result }));
    } catch { setMessage(t('marketing.previewError')); }
    finally { setBusy(false); }
  };

  const showAudience = async () => {
    setClientSheet(true);
    if (!businessId || !status || !(activePreviewChannel === 'email' || activePreviewChannel === 'web_push')) return;
    try {
    const result = await call<Preview>(client, businessId, { action: 'preview', channel: activePreviewChannel, goal: goal === 'other' ? 'offer' : goal, segment, ...(serviceId ? { service_id: serviceId } : {}), include_sample: true });
      setPreviews((current) => ({ ...current, [activePreviewChannel]: result }));
    } catch { setMessage(t('marketing.previewError')); }
  };

  useEffect(() => { if (view === 'campaign' && step === 2 && status) void loadAudience(); }, [view, step, segment, goal, serviceId, status?.channels]);

  const segmentsForGoal = (value: Goal): Segment[] => value === 'fill_opening' ? ['booked_service', 'recent_180', 'consented_clients']
    : value === 'rebook' ? ['lapsed_60', 'recent_180', 'consented_clients']
      : value === 'rebooking_reminder' ? ['due_rebook', 'recent_180', 'consented_clients']
        : ['recent_180', 'consented_clients'];
  const defaultSegment = (value: Goal): Segment => value === 'fill_opening' ? 'booked_service' : value === 'rebook' ? 'lapsed_60' : value === 'rebooking_reminder' ? 'due_rebook' : 'consented_clients';

  const openCampaign = (nextGoal: Goal = 'fill_opening') => {
    setEditingId(null); setName(''); setSegment(defaultSegment(nextGoal)); setGoal(nextGoal); setSelected(['email']); setOpening(null); setServiceId(null); setSubject(nextGoal === 'fill_opening' ? 'A time just opened up' : 'A note from your stylist');
    setCopy(nextGoal === 'fill_opening' ? 'Hi {first name}, I had a cancellation and have an opening this week. Want it? Book here and it’s yours.' : nextGoal === 'rebooking_reminder' ? 'Hi {first name}, it may be time to book your next visit. Choose a time that works for you.' : 'Hi {first name}, I’d love to see you again. Pick a time that works for you and book your next visit.');
    setPreviews({}); setAudienceCounts({}); setMessage(''); setStep(1); setMessageChannel('email'); setView('campaign');
  };

  const openDraft = async (id: string) => {
    if (!businessId) return;
    setBusy(true); setMessage('');
    try {
      const { campaign } = await call<{ campaign: DraftCampaign }>(client, businessId, { action: 'get', id });
      const channelRows = campaign.mova_marketing_campaign_channels ?? [];
      const draftGoal = (campaign.goal as Goal) ?? 'fill_opening';
      setEditingId(campaign.id); setName(campaign.name); setGoal(draftGoal);
      setSegment(segmentsForGoal(draftGoal).includes(campaign.audience?.segment as Segment) ? campaign.audience?.segment as Segment : defaultSegment(draftGoal)); setServiceId(campaign.audience?.service_id ?? null); setOpening(null); setSelected(channelRows.map((row) => row.channel));
      for (const row of channelRows) {
        if (row.channel === 'email') { setSubject(String(row.content.subject ?? '')); setCopy(String(row.content.text ?? '')); }
        else if (row.channel === 'social') { setCaptions((current) => ({ ...current, ...((row.content.social_captions ?? {}) as Record<string, string>) })); setSocialDestinations((row.content.social_destinations ?? []) as string[]); }
        else setCopy(String(row.content.text ?? ''));
      }
      setStep(1); setMessageChannel('email'); setView('campaign');
    } catch { setMessage(t('marketing.saveError')); }
    finally { setBusy(false); }
  };

  const saveDraft = async () => {
    if (!businessId || !selected.length || (segment === 'booked_service' && !serviceId)) { setMessage(t('marketing.validation')); return; }
    const campaignName = name.trim() || (goal === 'fill_opening' ? 'New opening' : goalLabel);
    setBusy(true); setMessage('');
    try {
      await call(client, businessId, { action: 'save', ...(editingId ? { id: editingId } : {}), name: campaignName, goal: goal === 'other' ? 'offer' : goal,
        audience: { segment, ...(serviceId ? { service_id: serviceId } : {}), ...(opening ? { location_id: opening.location_id } : {}) },
        channels: selected.map((channel) => ({ channel, content: channel === 'email' ? { subject, text: copy, cta: 'Book this opening', ...(opening ? { scheduled_local: opening.starts_at } : {}) } : channel === 'social' ? { social_captions: captions, social_destinations: socialDestinations } : { text: copy, cta: 'Book this opening' } })) });
      setEditingId(null); setView('home'); setMessage(t('marketing.saved')); await load();
    } catch { setMessage(t('marketing.saveError')); }
    finally { setBusy(false); }
  };

  const cancel = async (id: string) => { if (!businessId) return; setCancelId(id); };
  const confirmCancel = async () => { if (!businessId || !cancelId) return; setBusy(true); try { await call(client, businessId, { action: 'cancel', id: cancelId }); setCancelId(null); await load(); } catch { setMessage(t('marketing.saveError')); } finally { setBusy(false); } };
  const back = () => {
    if (view === 'ideas') { setView('home'); return; }
    if (view === 'channels') { setView('home'); return; }
    if (view === 'campaign') { if (step > 1) { setStep((value) => value - 1); return; } setView('home'); }
    else navigate(operatorUrl(businessId ?? '', 'growth'));
  };

  if (identityLoading || loading) return <main className="mova-page mova-marketing-page"><p role="status" aria-busy="true">{t('marketing.loading')}</p></main>;
  if (failed) return <main className="mova-page mova-marketing-page"><ErrorState title={t('marketing.loadError')} retryLabel={t('marketing.retry')} onRetry={() => void load()} /></main>;
  if (!status || !businessId) return <main className="mova-page mova-marketing-page"><p role="alert">{t('marketing.identityError')}</p></main>;

  return <main className={`mova-page mova-marketing-page mova-marketing-page--${view}`}>
    <ScreenHeader onBack={back} backLabel={t('marketing.back')} />
    {!online && <OfflineBanner>{t('marketing.offline')}</OfflineBanner>}

    {view === 'home' && <>
      <header className="mova-marketing-heading"><h1>{t('marketing.title')}</h1><p>{t('marketing.homeIntro')}</p></header>
      {/* T8: on a plan without marketing the screen stays visible, locked, with what unlocks it. */}
      {!campaignAvailable && <LockCard requiredPlan="pro" title={t('planGate.marketing.title')} body={t('planGate.marketing.body')} featureName={t('planGate.marketing.name')} />}
      <div className={campaignAvailable ? 'mova-marketing-home' : 'mova-marketing-home mova-locked'} {...(campaignAvailable ? {} : { 'aria-hidden': true, inert: true })}>
      {(() => { const draft = status.campaigns.find((campaign) => campaign.status === 'draft'); return <Card tone="inverse" className="mova-marketing-hero"><h2>{draft ? draft.name : openings[0] ? t('marketing.openingHero', { date: localDateTime(openings[0].starts_at, i18n.resolvedLanguage ?? 'en-US') }) : t('marketing.heroTitle')}</h2><p>{draft ? t('marketing.draftReady') : openings[0] ? t('marketing.openingEligible', { count: homeCounts.opening ?? '—' }) : t('marketing.heroDetail')}</p><Button variant="on-dark" onClick={() => draft ? void openDraft(draft.id) : setView('ideas')}>{draft ? t('marketing.reviewDraft') : t('marketing.createCampaign')}</Button></Card>; })()}
        <section className="mova-marketing-ideas"><h2>{t('marketing.moreIdeas')}</h2>
        <button type="button" className="mova-marketing-idea" onClick={() => openCampaign('rebook')}><span className="mova-marketing-icon">↶</span><span><strong>{t('marketing.winbackIdea')}</strong><small>{t('marketing.winbackDetail')}</small></span><b>{homeCounts.winback ?? '—'}<small>{t('marketing.clients')}</small></b></button>
        <button type="button" className="mova-marketing-idea" onClick={() => openCampaign('rebooking_reminder')}><span className="mova-marketing-icon">↻</span><span><strong>{t('marketing.rebookingIdea')}</strong><small>{t('marketing.rebookingDetail')}</small></span><b>{homeCounts.rebooking ?? '—'}<small>{t('marketing.clients')}</small></b></button>
      </section>
      <section className="mova-marketing-campaign-section"><div className="mova-marketing-section-title"><h2>{t('marketing.yourCampaigns')}</h2><button type="button" onClick={() => setView('ideas')}>{t('marketing.new')}</button></div>
        {status.campaigns.length ? <ul className="mova-marketing-campaigns">{status.campaigns.map((campaign) => <li key={campaign.id}><Card><div className="mova-marketing-campaign"><div><strong>{campaign.name}</strong><small>{t(`marketing.goalName.${campaign.goal}`, { defaultValue: campaign.goal })}</small></div><StatusChip status={campaign.status === 'sent' ? 'confirmed' : campaign.status === 'failed' ? 'cancelled' : 'pending'}>{t(`marketing.status.${campaign.status}`, { defaultValue: campaign.status })}</StatusChip></div><small>{(campaign.mova_marketing_campaign_channels ?? []).map((item) => channelTitle(item.channel)).join(' · ')}{campaign.scheduled_at ? ` · ${localDateTime(campaign.scheduled_at, i18n.resolvedLanguage ?? 'en-US')}` : ` · ${t('marketing.notScheduled')}`}</small>{campaign.status === 'draft' && <Button variant="secondary" disabled={busy || !online} onClick={() => void openDraft(campaign.id)}>{t('marketing.edit')}</Button>}{['draft','scheduled'].includes(campaign.status) && <Button variant="ghost" disabled={busy || !online} onClick={() => void cancel(campaign.id)}>{t('marketing.cancel')}</Button>}</Card></li>)}</ul> : <EmptyState title={t('marketing.emptyTitle')} detail={t('marketing.emptyDetail')} action={<Button onClick={() => setView('ideas')}>{t('marketing.createCampaign')}</Button>} />}
      </section>
      <button type="button" className="mova-marketing-channel-entry" onClick={() => setView('channels')}><span><strong>{t('marketing.channels')}</strong><small>{t('marketing.channelSummary', { ready: channels.filter((channel) => status.channels[channel].ready).length, available: channels.filter((channel) => status.channels[channel].plan).length })}</small></span><Icon name="chevron" size={20} /></button>
      </div>
      {message && <p className="mova-marketing-message" role="status">{message}</p>}
    </>}

    {view === 'ideas' && <>
      <header className="mova-marketing-heading"><h1>{t('marketing.newCampaignTitle')}</h1><p>{t('marketing.newCampaignIntro')}</p></header>
      <div className="mova-marketing-idea-list">{goalOptions.filter((item) => item.id !== 'other').map((item) => <button type="button" className="mova-marketing-idea-card" key={item.id} onClick={() => openCampaign(item.id)}><span className="mova-marketing-icon">{item.icon}</span><span><strong>{t(`marketing.goalName.${item.id}`)}</strong><small>{t(`marketing.goalDetail.${item.id}`)}</small></span><Icon name="chevron" size={20} /></button>)}</div>
      <p className="mova-marketing-reassurance">{t('marketing.campaignReviewPromise')}</p>
    </>}

    {view === 'channels' && <>
      <header className="mova-marketing-heading"><h1>{t('marketing.channels')}</h1><p>{t('marketing.channelsIntro')}</p></header>
      <div className="mova-marketing-channel-list">{channels.map((channel) => {
        const gate = status.channels[channel];
        const action = !gate.plan ? (channel === 'wallet' ? t('marketing.channelAction.aiGrowth') : t('marketing.channelAction.pro')) : gate.ready ? t('marketing.channelAction.ready') : !gate.platform ? t('marketing.channelAction.paused') : channel === 'social' ? t('marketing.channelAction.connect') : t('marketing.channelAction.setup');
        return <article className="mova-marketing-channel-card" key={channel}><span className="mova-marketing-icon">{channelIcon[channel]}</span><span className="mova-marketing-channel-copy"><strong>{t(`marketing.channelName.${channel}`)}</strong><small>{t(`marketing.channelSetup.${channel}`)}</small></span><StatusChip status={gate.plan ? 'confirmed' : 'pending'}>{action}</StatusChip></article>;
      })}</div>
      <Card className="mova-marketing-email-setup"><h2>{t('marketing.emailSetup')}</h2><div><span>{t('marketing.senderName')}</span><strong>{businessName || t('marketing.notSet')}</strong></div><div><span>{t('marketing.replyTo')}</span><strong>{t('marketing.notSet')}</strong></div><div><span>{t('marketing.postalAddress')}</span><strong>{t('marketing.needsVerification')}</strong></div></Card>
      <p className="mova-marketing-reassurance mova-marketing-email-note">{t('marketing.emailUnsubscribeNote')}</p>
    </>}

    {view === 'campaign' && <>
      <div className="mova-marketing-progress" aria-label={t('marketing.step', { step })}>{[1,2,3,4].map((value) => <span key={value} className={value <= step ? 'is-complete' : ''} />)}</div>
      <p className="mova-marketing-step-label">{t('marketing.step', { step })}</p>
      {step === 1 && <>
        <header className="mova-marketing-heading"><h1>{t('marketing.goalHeading')}</h1><p>{t('marketing.goalIntro')}</p></header>
        <div className="mova-marketing-choice-list" role="radiogroup" aria-label={t('marketing.goalLabel')}>{goalOptions.map((item) => <button type="button" key={item.id} role="radio" aria-checked={goal === item.id} className={`mova-marketing-choice${goal === item.id ? ' is-selected' : ''}`} onClick={() => { setGoal(item.id); setSegment(defaultSegment(item.id)); }}><span><strong>{t(`marketing.goalName.${item.id}`, { defaultValue: t('marketing.goalName.offer') })}</strong><small>{t(`marketing.goalDetail.${item.id}`, { defaultValue: t('marketing.goalDetail.other') })}</small></span><i>{goal === item.id ? <Icon name="check" size={16} /> : null}</i></button>)}</div>
        {goal === 'fill_opening' && <div className="mova-marketing-opening-select"><label>{t('marketing.goalOpeningLabel')}</label><button type="button" className="mova-marketing-opening-button" onClick={() => setOpeningSheet(true)}><span>{opening ? `${localDateTime(opening.starts_at, i18n.resolvedLanguage ?? 'en-US')} · ${opening.service_name_snapshot}` : t('marketing.chooseOpening')}</span><Icon name="chevron" size={18} /></button>{!openings.length && <small>{t('marketing.newOpeningNote')}</small>}</div>}
      </>}

      {step === 2 && <>
        <header className="mova-marketing-heading"><h1>{t('marketing.audienceHeading')}</h1><p>{t('marketing.audienceIntro')}</p></header>
        <div className="mova-marketing-choice-list" role="radiogroup" aria-label={t('marketing.audienceLabel')}>{segmentsForGoal(goal).map((option) => {
          const count = audienceCounts[option]; const best = option === defaultSegment(goal); const labels: Record<Segment, [string,string]> = { booked_service:[serviceId ? `Booked a ${opening?.service_name_snapshot ?? 'service'} before` : t('marketing.bookedThisService'),best ? t('marketing.bestMatchOpening') : t('marketing.pastService')], recent_180:[t('marketing.segment.recent_180'),t('marketing.segmentDetail.recent_180')], consented_clients:[t('marketing.segment.consented_clients'),t('marketing.segmentDetail.consented_clients')], lapsed_60:[t('marketing.segment.lapsed_60'),best ? t('marketing.bestMatchWinback') : t('marketing.segmentDetail.lapsed_60')], due_rebook:[t('marketing.segment.due_rebook'),best ? t('marketing.bestMatchRebook') : t('marketing.segmentDetail.due_rebook')] };
          return <div key={option} role="presentation" className={`mova-marketing-choice mova-marketing-choice--audience${segment === option ? ' is-selected' : ''}`}><button type="button" role="radio" aria-checked={segment === option} className="mova-marketing-audience-select" onClick={() => setSegment(option)}><span><strong>{labels[option][0]}</strong><small>{labels[option][1]}</small><em>{busy ? '…' : count == null ? '—' : t('marketing.clientsCount', { count })}</em></span><i>{segment === option ? <Icon name="check" size={16} /> : null}</i></button>{segment === option && <button type="button" className="mova-marketing-see-who" onClick={() => void showAudience()}>{t('marketing.seeWho')}</button>}</div>;
        })}</div>
        <aside className="mova-marketing-not-included"><strong>{t('marketing.notIncluded')} <span>{selectedPreview?.considered != null && eligibleCount != null ? Math.max(0, selectedPreview.considered - eligibleCount) : '—'}</span></strong><small>{t('marketing.consentExclusion')}</small></aside>
        {message && <p className="mova-marketing-message" role="alert">{message}</p>}
      </>}

      {step === 3 && <>
        <header className="mova-marketing-heading"><h1>{t('marketing.messageHeading')}</h1><p>{t('marketing.messageIntro')}</p></header>
        <div className="mova-marketing-tabs" role="tablist" aria-label="Channel preview">{(['email','social'] as const).filter((channel) => status.channels[channel].plan).map((channel) => <button type="button" key={channel} role="tab" aria-selected={messageChannel === channel} onClick={() => { setMessageChannel(channel); setSelected((current) => current.includes(channel) ? current : [...current, channel]); }}>{channel === 'social' ? t('marketing.instagram') : t('marketing.channelName.email')}</button>)}</div>
        {messageChannel === 'social' ? <TextArea label={t('marketing.socialCaption')} value={captions.instagram ?? ''} onChange={(event) => setCaptions((current) => ({ ...current, instagram: event.target.value }))} maxLength={2200} /> : <>
          <TextField label={t('marketing.subject')} value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} />
          <TextArea label={t('marketing.message')} value={copy} onChange={(event) => setCopy(event.target.value)} maxLength={1000} />
          <small className="mova-marketing-character-count">{copy.length} characters</small>
        </>}
        <div className="mova-marketing-tone-actions">{[[t('marketing.toneWarmer'),'warmer'],[t('marketing.toneShorter'),'shorter'],[t('marketing.toneFormal'),'formal']].map(([label,key])=><button type="button" key={key} onClick={() => setCopy((text) => key === 'shorter' ? text.split(/[.!?]/)[0] + '.' : text)}>{label}</button>)}</div>
          <Card className="mova-marketing-email-preview"><span className="mova-marketing-eyebrow">{t('marketing.preview')}</span><strong>{messageChannel === 'social' ? t('marketing.instagramPost') : subject}</strong><p>{(messageChannel === 'social' ? captions.instagram ?? '' : copy).replace('{first name}', t('marketing.previewGreeting')).slice(0, 118)}{(messageChannel === 'social' ? (captions.instagram ?? '').length : copy.length) > 118 ? '…' : ''}</p><button type="button">{goal === 'rebook' || goal === 'rebooking_reminder' ? t('marketing.rebookNow') : t('marketing.bookNow')}</button></Card>
      </>}

      {step === 4 && <>
        <header className="mova-marketing-heading"><h1>{t('marketing.scheduleHeading')}</h1><p>{t('marketing.scheduleIntro')}</p></header>
        <div className="mova-marketing-review-list">{[{key:'goal',label:t('marketing.reviewGoal'),value:goalLabel},{key:'who',label:t('marketing.reviewWho'),value:`${eligibleCount ?? '—'} ${t('marketing.clients')} · ${segment === 'booked_service' ? t('marketing.bookedThisService') : segment === 'recent_180' ? t('marketing.visitedSixMonths') : segment === 'due_rebook' ? t('marketing.segment.due_rebook') : segment === 'lapsed_60' ? t('marketing.segment.lapsed_60') : t('marketing.optedIn')}`},{key:'message',label:t('marketing.reviewMessage'),value:`“${subject}”`}].map((item)=><div key={item.key}><span><small>{item.label}</small><strong>{item.value}</strong></span><button type="button" onClick={() => setStep(item.key === 'goal' ? 1 : item.key === 'who' ? 2 : 3)}>{t('marketing.edit')}</button></div>)}</div>
        <section className="mova-marketing-final-channels"><h2>{t('marketing.whereItGoes')}</h2>{channels.filter((channel) => status.channels[channel].plan).map((channel) => <div key={channel}><span><strong>{channel === 'social' ? t('marketing.instagram') : channelTitle(channel)}</strong><small>{channel === 'email' ? t('marketing.channelEmailClients', { count: eligibleCount ?? 0 }) : status.channels[channel].platform ? t('marketing.connected') : t('marketing.connectFirst')}</small></span>{channel === 'email' ? <button type="button" role="switch" aria-checked={selected.includes(channel)} className={`mova-marketing-switch${selected.includes(channel) ? ' is-on' : ''}`} onClick={() => setSelected((items) => items.includes(channel) ? items.filter((item) => item !== channel) : [...items, channel])}><span /></button> : <button type="button" className="mova-marketing-connect" disabled={!status.channels[channel].platform}>{status.channels[channel].platform ? t('marketing.connected') : t('marketing.connect')}</button>}</div>)}</section>
        <section className="mova-marketing-when"><h2>{t('marketing.when')}</h2><div className="mova-marketing-tabs"><button type="button" disabled={!status.delivery_enabled} aria-pressed={sendMode === 'now'} onClick={() => setSendMode('now')}>{t('marketing.sendNow')}</button><button type="button" disabled={!status.delivery_enabled} aria-pressed={sendMode === 'schedule'} onClick={() => setSendMode('schedule')}>{t('marketing.schedule')}</button></div>{sendMode === 'schedule' && status.delivery_enabled && <TextField label={t('marketing.dateTime')} type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />}</section>
        <p className="mova-marketing-delivery-note">{status.delivery_enabled ? t('marketing.localTime') : t('marketing.safetyTitle')}</p>
        {message && <p className="mova-marketing-message" role="status">{message}</p>}
      </>}

      <footer className={`mova-marketing-wizard-actions${step === 4 ? ' mova-marketing-wizard-actions--final' : ''}`}>{step === 1 ? <Button variant="secondary" onClick={() => setView('home')}>{t('marketing.cancel')}</Button> : <Button variant="secondary" onClick={() => setStep((value) => Math.max(1, value - 1))}>{t('marketing.back')}</Button>}{step < 4 ? <Button onClick={() => { if (step === 1 && goal === 'fill_opening' && !opening) { setOpeningSheet(true); return; } setMessage(''); setStep((value) => value + 1); }}>{t('marketing.continue')}</Button> : <Button disabled={busy || !online || !selected.length} loading={busy} onClick={() => void saveDraft()}>{t('marketing.saveDraft')}</Button>}</footer>
    </>}

    <Sheet open={clientSheet} title={t('marketing.channelEmailClients', { count: eligibleCount ?? 0 })} closeLabel={t('settings.close')} onClose={() => setClientSheet(false)}>
      <p className="mova-marketing-sheet-description">{t('marketing.openingDescription')}</p>
      {selectedPreview?.sample_clients?.length ? <ul className="mova-marketing-client-list">{selectedPreview.sample_clients.slice(0, 4).map((item) => <li key={item.id}><span><strong>{item.display_name}</strong><small>{item.last_visit_at ? `Last visit ${new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: 'short', day: 'numeric' }).format(new Date(item.last_visit_at))}` : t('marketing.clientFallback')}</small></span><small>{channelTitle(activePreviewChannel)}</small></li>)}</ul> : <Card className="mova-marketing-no-samples">{t('marketing.exactAudienceRecheck')}</Card>}
      <p className="mova-marketing-more-clients">{eligibleCount && eligibleCount > 4 ? t('marketing.moreClients', { count: eligibleCount - 4 }) : ''}</p>
      <Button variant="secondary" onClick={() => setClientSheet(false)}>{t('marketing.close')}</Button>
    </Sheet>
    <Sheet open={openingSheet} title={t('marketing.chooseOpening')} closeLabel={t('settings.close')} onClose={() => setOpeningSheet(false)}>
      {openings.length ? <ul className="mova-marketing-opening-list">{openings.map((item) => <li key={item.id}><button type="button" onClick={() => { setOpening(item); setServiceId(item.service_id); setSegment('booked_service'); setOpeningSheet(false); }}><strong>{localDateTime(item.starts_at, i18n.resolvedLanguage ?? 'en-US')}</strong><small>{item.service_name_snapshot} · {item.location_name}</small></button></li>)}</ul> : <p className="mova-marketing-sheet-description">{t('marketing.emptyOpenings')}</p>}
      <Button variant="secondary" onClick={() => { setOpeningSheet(false); if (!openings.length) { setGoal('rebook'); setSegment('consented_clients'); setServiceId(null); setStep(2); } }}>{t('marketing.continueWithoutOpening')}</Button>
    </Sheet>
    <Sheet open={Boolean(cancelId)} title={t('marketing.cancelTitle')} closeLabel={t('settings.close')} onClose={() => setCancelId(null)}>
      <p className="mova-marketing-sheet-description">{t('marketing.cancelConfirm')}</p>
      <div className="mova-marketing-sheet-actions"><Button variant="secondary" disabled={busy} onClick={() => setCancelId(null)}>{t('marketing.cancel')}</Button><Button disabled={busy} loading={busy} onClick={() => void confirmCancel()}>{t('marketing.cancel')}</Button></div>
    </Sheet>
  </main>;
}
