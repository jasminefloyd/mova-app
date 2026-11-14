import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button, Card, EmptyState, ErrorState, Icon, OfflineBanner, ScreenHeader, Sheet, StatusChip, TextArea, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import './marketing.css';

type Channel = 'email' | 'social' | 'web_push' | 'wallet';
type Goal = 'fill_opening' | 'rebook' | 'offer' | 'other';
type Segment = 'booked_service' | 'recent_180' | 'consented_clients';
type Campaign = { id: string; name: string; goal: string; status: string; created_at: string; scheduled_at?: string | null; mova_marketing_campaign_channels?: Array<{ channel: Channel; status: string; error_code: string | null }> };
type ChannelGate = { plan: boolean; platform: boolean; ready: boolean };
type Status = { campaigns: Campaign[]; channels: Record<Channel, ChannelGate>; delivery_enabled: boolean };
type SampleClient = { id: string; display_name: string; last_visit_at: string | null };
type Preview = { eligible: number | null; considered?: number; capped?: boolean; ready: boolean; reason: string | null; sample_clients?: SampleClient[] };
type Opening = { id: string; starts_at: string; service_name_snapshot: string; location_name: string; service_id: string; location_id: string };
type DraftCampaign = { id: string; name: string; goal: string; audience?: { segment?: string; service_id?: string; location_id?: string }; mova_marketing_campaign_channels?: Array<{ channel: Channel; content: Record<string, unknown> }> };

const channels: Channel[] = ['email', 'social', 'web_push', 'wallet'];
const segmentOptions: Segment[] = ['booked_service', 'recent_180', 'consented_clients'];
const goalOptions: Array<{ id: Goal; label: string; description: string; icon: string }> = [
  { id: 'fill_opening', label: 'Fill an opening', description: 'Tell clients about a time you have free.', icon: '📅' },
  { id: 'rebook', label: 'Win back clients', description: 'Reach clients who haven’t visited in a while.', icon: '↶' },
  { id: 'offer', label: 'Promote a service', description: 'Spotlight a service or a seasonal offer.', icon: '✂' },
  { id: 'other', label: 'Something else', description: 'Write your own message.', icon: '✦' },
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
  const [clientSheet, setClientSheet] = useState(false);
  const [openingSheet, setOpeningSheet] = useState(false);
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
      setOpenings((openingResult.data ?? []).map((row: any) => ({ id: row.id, starts_at: row.starts_at, service_name_snapshot: row.service_name_snapshot, service_id: row.service_id, location_id: row.location_id, location_name: row.mova_locations?.name ?? '' })));
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
  const goalLabel = goalOptions.find((item) => item.id === goal)?.label ?? goalOptions[0]!.label;
  const channelTitle = (channel: Channel) => t(`marketing.channel.${channel}`, { defaultValue: channel === 'social' ? 'Instagram & Facebook' : channel === 'web_push' ? 'Web push' : channel[0]!.toUpperCase() + channel.slice(1) });

  const previewChannel = async (channel: Channel, targetSegment: Segment) => {
    if (!businessId) return null;
    return call<Preview>(client, businessId, { action: 'preview', channel, goal: goal === 'other' ? 'offer' : goal, segment: targetSegment, ...(serviceId ? { service_id: serviceId } : {}) });
  };

  const loadAudience = async () => {
    if (!businessId || !status) return;
    setBusy(true); setMessage('');
    const channel = selected.find((item) => status.channels[item].plan && (item === 'email' || item === 'web_push')) ?? (status.channels.email.plan ? 'email' : 'web_push');
    try {
      const results = await Promise.all(segmentOptions.map(async (option) => [option, await previewChannel(channel, option)] as const));
      setAudienceCounts(Object.fromEntries(results.map(([option, result]) => [option, result.eligible])) as Partial<Record<Segment, number | null>>);
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

  useEffect(() => { if (view === 'campaign' && step === 2 && status) void loadAudience(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [view, step, segment, status?.channels]);

  const openCampaign = (nextGoal: Goal = 'fill_opening') => {
    setEditingId(null); setName(''); setSegment(nextGoal === 'fill_opening' ? 'booked_service' : 'consented_clients'); setGoal(nextGoal); setSelected(['email']); setOpening(null); setServiceId(null); setSubject(nextGoal === 'fill_opening' ? 'A time just opened up' : 'A note from your stylist');
    setCopy(nextGoal === 'fill_opening' ? 'Hi {first name}, I had a cancellation and have an opening this week. Want it? Book here and it’s yours.' : 'Hi {first name}, I’d love to see you again. Pick a time that works for you and book your next visit.');
    setPreviews({}); setAudienceCounts({}); setMessage(''); setStep(1); setMessageChannel('email'); setView('campaign');
  };

  const openDraft = async (id: string) => {
    if (!businessId) return;
    setBusy(true); setMessage('');
    try {
      const { campaign } = await call<{ campaign: DraftCampaign }>(client, businessId, { action: 'get', id });
      const channelRows = campaign.mova_marketing_campaign_channels ?? [];
      setEditingId(campaign.id); setName(campaign.name); setGoal((campaign.goal as Goal) ?? 'fill_opening');
      setSegment(segmentOptions.includes(campaign.audience?.segment as Segment) ? campaign.audience?.segment as Segment : 'consented_clients'); setServiceId(campaign.audience?.service_id ?? null); setOpening(null); setSelected(channelRows.map((row) => row.channel));
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
      setEditingId(null); setView('home'); setMessage(sendMode === 'schedule' ? 'Draft saved. Campaign scheduling is paused until delivery is enabled.' : 'Draft saved. No message was sent.'); await load();
    } catch { setMessage(t('marketing.saveError')); }
    finally { setBusy(false); }
  };

  const cancel = async (id: string) => { if (!businessId || !window.confirm(t('marketing.cancelConfirm'))) return; setBusy(true); try { await call(client, businessId, { action: 'cancel', id }); await load(); } catch { setMessage(t('marketing.saveError')); } finally { setBusy(false); } };
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
    <ScreenHeader onBack={back} backLabel={t('messaging.back')} />
    {!online && <OfflineBanner>{t('marketing.offline')}</OfflineBanner>}

    {view === 'home' && !campaignAvailable && <>
      <header className="mova-marketing-heading"><h1>Marketing</h1><p>Available on Pro and above.</p></header>
      <Card tone="inverse" className="mova-marketing-locked"><h2>Fill openings and win back clients</h2><p>Mova drafts the message, finds the right clients and schedules it for you.</p><Button variant="on-dark" onClick={() => navigate(operatorUrl(businessId, 'settings/plan'))}>See plans</Button></Card>
      <Card className="mova-marketing-mini-preview"><span className="mova-marketing-eyebrow">Preview</span><div className="mova-marketing-preview-row"><span className="mova-marketing-icon">📅</span><span><strong>Fill Thursday’s opening</strong><small>Booked a silk press before</small></span><b>14<small>clients</small></b></div></Card>
      <p className="mova-marketing-reassurance">Your clients and bookings stay yours on every plan.</p>
    </>}

    {view === 'home' && campaignAvailable && <>
      <header className="mova-marketing-heading"><h1>Marketing</h1><p>Bring clients back with a message that sounds like you.</p></header>
      <Card tone="inverse" className="mova-marketing-hero"><h2>{openings[0] ? `Fill ${localDateTime(openings[0].starts_at, i18n.resolvedLanguage ?? 'en-US')} opening` : 'Reach the right clients, at the right time'}</h2><p>{eligibleCount !== null ? `${eligibleCount} clients who booked before could hear about it.` : 'Choose a goal and audience. Mova will prepare a draft for you to review.'} Mova has a draft ready.</p><Button variant="on-dark" onClick={() => openCampaign('fill_opening')}>Review the draft</Button></Card>
      <section className="mova-marketing-ideas"><h2>More ideas</h2>
        {[['rebook','Win back quiet clients','Not booked in 90 days',9],['offer','Remind to rebook','Due for a visit this week',12]].map(([id,title,detail,count])=><button type="button" className="mova-marketing-idea" key={String(id)} onClick={() => openCampaign(id === 'rebook' ? 'rebook' : 'offer')}><span className="mova-marketing-icon">{id === 'rebook' ? '↶' : '📅'}</span><span><strong>{title}</strong><small>{detail}</small></span><b>{count}<small>clients</small></b></button>)}
      </section>
      <section className="mova-marketing-campaign-section"><div className="mova-marketing-section-title"><h2>Your campaigns</h2><button type="button" onClick={() => setView('ideas')}>New</button></div>
        {status.campaigns.length ? <ul className="mova-marketing-campaigns">{status.campaigns.map((campaign) => <li key={campaign.id}><Card><div className="mova-marketing-campaign"><div><strong>{campaign.name}</strong><small>{t(`marketing.goalName.${campaign.goal}`, { defaultValue: campaign.goal })}</small></div><StatusChip status={campaign.status === 'sent' ? 'confirmed' : campaign.status === 'failed' ? 'cancelled' : 'pending'}>{t(`marketing.status.${campaign.status}`, { defaultValue: campaign.status })}</StatusChip></div><small>{(campaign.mova_marketing_campaign_channels ?? []).map((item) => channelTitle(item.channel)).join(' · ')}{campaign.scheduled_at ? ` · ${localDateTime(campaign.scheduled_at, i18n.resolvedLanguage ?? 'en-US')}` : ' · not scheduled'}</small>{campaign.status === 'draft' && <Button variant="secondary" disabled={busy || !online} onClick={() => void openDraft(campaign.id)}>Edit draft</Button>}{['draft','scheduled'].includes(campaign.status) && <Button variant="ghost" disabled={busy || !online} onClick={() => void cancel(campaign.id)}>{t('marketing.cancel')}</Button>}</Card></li>)}</ul> : <EmptyState title={t('marketing.emptyTitle')} detail={t('marketing.emptyDetail')} action={<Button onClick={() => setView('ideas')}>New campaign</Button>} />}
      </section>
      <button type="button" className="mova-marketing-channel-entry" onClick={() => setView('channels')}><span><strong>Channels</strong><small>Email is ready · 3 more to set up</small></span><Icon name="chevron" size={20} /></button>
      {message && <p className="mova-marketing-message" role="status">{message}</p>}
    </>}

    {view === 'ideas' && <>
      <header className="mova-marketing-heading"><h1>Marketing</h1><p>Pick a goal. Mova drafts the message and finds the right clients.</p></header>
      <div className="mova-marketing-idea-list">{goalOptions.filter((item) => item.id !== 'other').map((item) => <button type="button" className="mova-marketing-idea-card" key={item.id} onClick={() => openCampaign(item.id)}><span className="mova-marketing-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.description}</small></span><Icon name="chevron" size={20} /></button>)}</div>
      <p className="mova-marketing-reassurance">You always review who will receive a message before anything is scheduled.</p>
    </>}

    {view === 'channels' && <>
      <header className="mova-marketing-heading"><h1>Channels</h1><p>Where your messages go. Set up once, reuse every time.</p></header>
      <div className="mova-marketing-channel-list">{channels.map((channel) => {
        const gate = status.channels[channel];
        const action = channel === 'email' ? (gate.plan ? (gate.platform ? 'Ready' : 'Set up') : 'Pro') : channel === 'social' ? 'Connect' : channel === 'web_push' ? 'Set up' : 'Pro';
        return <article className="mova-marketing-channel-card" key={channel}><span className="mova-marketing-icon">{channelIcon[channel]}</span><span className="mova-marketing-channel-copy"><strong>{channel === 'social' ? 'Instagram & Facebook' : channelTitle(channel)}</strong><small>{channel === 'email' ? 'Sends from your name' : channel === 'social' ? 'Post to your page' : channel === 'web_push' ? 'Clients who allow alerts' : 'Pass updates for clients'}</small></span><StatusChip status={gate.plan ? 'confirmed' : 'pending'}>{action}</StatusChip></article>;
      })}</div>
      <Card className="mova-marketing-email-setup"><h2>Email setup</h2><div><span>Sender name</span><strong>{businessName || 'Not set'}</strong></div><div><span>Reply-to</span><strong>Not set</strong></div><div><span>Postal address</span><strong>Needs verification</strong></div></Card>
      <p className="mova-marketing-reassurance mova-marketing-email-note">Every email includes an unsubscribe link. Clients who opt out are never contacted again.</p>
    </>}

    {view === 'campaign' && <>
      <div className="mova-marketing-progress" aria-label={`Step ${step} of 4`}>{[1,2,3,4].map((value) => <span key={value} className={value <= step ? 'is-complete' : ''} />)}</div>
      <p className="mova-marketing-step-label">Step {step} of 4</p>
      {step === 1 && <>
        <header className="mova-marketing-heading"><h1>What’s the goal?</h1><p>Pick one. You can change the message later.</p></header>
        <div className="mova-marketing-choice-list" role="radiogroup" aria-label="Campaign goal">{goalOptions.map((item) => <button type="button" key={item.id} role="radio" aria-checked={goal === item.id} className={`mova-marketing-choice${goal === item.id ? ' is-selected' : ''}`} onClick={() => setGoal(item.id)}><span><strong>{item.label}</strong><small>{item.description}</small></span><i>{goal === item.id ? <Icon name="check" size={16} /> : null}</i></button>)}</div>
        {goal === 'fill_opening' && <div className="mova-marketing-opening-select"><label>Opening to fill</label><button type="button" className="mova-marketing-opening-button" onClick={() => setOpeningSheet(true)}><span>{opening ? `${localDateTime(opening.starts_at, i18n.resolvedLanguage ?? 'en-US')} · ${opening.service_name_snapshot}` : 'Choose a newly opened time'}</span><Icon name="chevron" size={18} /></button>{!openings.length && <small>New openings from cancelled appointments will appear here.</small>}</div>}
      </>}

      {step === 2 && <>
        <header className="mova-marketing-heading"><h1>Who should hear about it?</h1><p>Only clients who’ve agreed to hear from you.</p></header>
        <div className="mova-marketing-choice-list" role="radiogroup" aria-label="Client audience">{segmentOptions.map((option) => {
          const count = audienceCounts[option]; const labels: Record<Segment, [string,string]> = { booked_service:[serviceId ? `Booked a ${opening?.service_name_snapshot ?? 'service'} before` : 'Booked this service before','Best match for this opening'], recent_180:['Visited in the last 6 months','Recent clients'], consented_clients:['All opted-in clients','Everyone who agreed to messages'] };
          return <div key={option} role="presentation" className={`mova-marketing-choice mova-marketing-choice--audience${segment === option ? ' is-selected' : ''}`}><button type="button" role="radio" aria-checked={segment === option} className="mova-marketing-audience-select" onClick={() => setSegment(option)}><span><strong>{labels[option][0]}</strong><small>{labels[option][1]}</small><em>{busy ? '…' : count == null ? '—' : `${count} clients`}</em></span><i>{segment === option ? <Icon name="check" size={16} /> : null}</i></button>{segment === option && <button type="button" className="mova-marketing-see-who" onClick={() => void showAudience()}>See who</button>}</div>;
        })}</div>
        <aside className="mova-marketing-not-included"><strong>Not included <span>{selectedPreview?.considered != null && eligibleCount != null ? Math.max(0, selectedPreview.considered - eligibleCount) : '—'}</span></strong><small>Unsubscribed and non-consenting clients are excluded. They’re never contacted.</small></aside>
        {message && <p className="mova-marketing-message" role="alert">{message}</p>}
      </>}

      {step === 3 && <>
        <header className="mova-marketing-heading"><h1>Review your message</h1><p>Mova wrote this from your goal. Edit anything.</p></header>
        <div className="mova-marketing-tabs" role="tablist" aria-label="Channel preview">{(['email','social'] as const).filter((channel) => status.channels[channel].plan).map((channel) => <button type="button" key={channel} role="tab" aria-selected={messageChannel === channel} onClick={() => { setMessageChannel(channel); setSelected((current) => current.includes(channel) ? current : [...current, channel]); }}>{channel === 'social' ? 'Instagram' : 'Email'}</button>)}</div>
        {messageChannel === 'social' ? <TextArea label="Instagram caption" value={captions.instagram ?? ''} onChange={(event) => setCaptions((current) => ({ ...current, instagram: event.target.value }))} maxLength={2200} /> : <>
          <TextField label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} />
          <TextArea label="Message" value={copy} onChange={(event) => setCopy(event.target.value)} maxLength={1000} />
          <small className="mova-marketing-character-count">{copy.length} characters</small>
        </>}
        <div className="mova-marketing-tone-actions">{[['Warmer','warmer'],['Shorter','shorter'],['More formal','formal']].map(([label,key])=><button type="button" key={key} onClick={() => setCopy((text) => key === 'shorter' ? text.split(/[.!?]/)[0] + '.' : text)}>{label}</button>)}</div>
        <Card className="mova-marketing-email-preview"><span className="mova-marketing-eyebrow">Preview</span><strong>{messageChannel === 'social' ? 'Instagram post' : subject}</strong><p>{(messageChannel === 'social' ? captions.instagram : copy).replace('{first name}', 'Maya').slice(0, 118)}{copy.length > 118 ? '…' : ''}</p><button type="button">{goal === 'rebook' ? 'Rebook now' : 'Book now'}</button></Card>
      </>}

      {step === 4 && <>
        <header className="mova-marketing-heading"><h1>Ready to schedule?</h1><p>Check the details one last time.</p></header>
        <div className="mova-marketing-review-list">{[["Goal",goalLabel],["Who",`${eligibleCount ?? '—'} clients · ${segment === 'booked_service' ? 'booked this service before' : segment === 'recent_180' ? 'visited in the last 6 months' : 'opted in'}`],["Message",`“${subject}”`]].map(([label,value])=><div key={label}><span><small>{label}</small><strong>{value}</strong></span><button type="button" onClick={() => setStep(label === 'Goal' ? 1 : label === 'Who' ? 2 : 3)}>Edit</button></div>)}</div>
        <section className="mova-marketing-final-channels"><h2>Where it goes</h2>{channels.filter((channel) => status.channels[channel].plan).map((channel) => <div key={channel}><span><strong>{channel === 'social' ? 'Instagram' : channelTitle(channel)}</strong><small>{channel === 'email' ? `${eligibleCount ?? 0} clients` : status.channels[channel].platform ? 'Connected' : 'Connect your account first'}</small></span>{channel === 'email' ? <button type="button" role="switch" aria-checked={selected.includes(channel)} className={`mova-marketing-switch${selected.includes(channel) ? ' is-on' : ''}`} onClick={() => setSelected((items) => items.includes(channel) ? items.filter((item) => item !== channel) : [...items, channel])}><span /></button> : <button type="button" className="mova-marketing-connect" disabled={!status.channels[channel].platform}>{status.channels[channel].platform ? 'Connected' : 'Connect'}</button>}</div>)}</section>
        <section className="mova-marketing-when"><h2>When</h2><div className="mova-marketing-tabs"><button type="button" aria-pressed={sendMode === 'now'} onClick={() => setSendMode('now')}>Send now</button><button type="button" aria-pressed={sendMode === 'schedule'} onClick={() => setSendMode('schedule')}>Schedule</button></div>{sendMode === 'schedule' && <TextField label="Date and time" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />}</section>
        <p className="mova-marketing-delivery-note">Each client gets it at 9:00 am their local time, inside quiet-hours limits. Sending and scheduling are paused until delivery is enabled.</p>
        {message && <p className="mova-marketing-message" role="status">{message}</p>}
      </>}

      <footer className={`mova-marketing-wizard-actions${step === 4 ? ' mova-marketing-wizard-actions--final' : ''}`}>{step === 1 ? <Button variant="secondary" onClick={() => setView('home')}>Cancel</Button> : <Button variant="secondary" onClick={() => setStep((value) => Math.max(1, value - 1))}>Back</Button>}{step < 4 ? <Button onClick={() => { if (step === 1 && goal === 'fill_opening' && !opening) { setOpeningSheet(true); return; } setMessage(''); setStep((value) => value + 1); }}>Continue</Button> : <><Button variant="secondary" disabled={busy || !online} onClick={() => void saveDraft()}>Save draft</Button><Button disabled={busy || !online || !selected.length || (sendMode === 'schedule' && !scheduledAt)} loading={busy} onClick={() => void saveDraft()}>{sendMode === 'schedule' ? 'Schedule' : 'Send now'}</Button></>}</footer>
    </>}

    <Sheet open={clientSheet} title={`${eligibleCount ?? 0} clients`} closeLabel={t('settings.close')} onClose={() => setClientSheet(false)}>
      <p className="mova-marketing-sheet-description">Booked this service before and agreed to hear from you.</p>
      {selectedPreview?.sample_clients?.length ? <ul className="mova-marketing-client-list">{selectedPreview.sample_clients.slice(0, 4).map((item) => <li key={item.id}><span><strong>{item.display_name}</strong><small>{item.last_visit_at ? `Last visit ${new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: 'short', day: 'numeric' }).format(new Date(item.last_visit_at))}` : 'Client'}</small></span><small>{channelTitle(activePreviewChannel)}</small></li>)}</ul> : <Card className="mova-marketing-no-samples">The exact eligible audience is checked again before delivery.</Card>}
      <p className="mova-marketing-more-clients">{eligibleCount && eligibleCount > 4 ? `+ ${eligibleCount - 4} more` : ''}</p>
      <Button variant="secondary" onClick={() => setClientSheet(false)}>Close</Button>
    </Sheet>
    <Sheet open={openingSheet} title="Choose an opening" closeLabel={t('settings.close')} onClose={() => setOpeningSheet(false)}>
      {openings.length ? <ul className="mova-marketing-opening-list">{openings.map((item) => <li key={item.id}><button type="button" onClick={() => { setOpening(item); setServiceId(item.service_id); setSegment('booked_service'); setOpeningSheet(false); }}><strong>{localDateTime(item.starts_at, i18n.resolvedLanguage ?? 'en-US')}</strong><small>{item.service_name_snapshot} · {item.location_name}</small></button></li>)}</ul> : <p className="mova-marketing-sheet-description">No future openings are available from cancelled appointments yet. You can save a draft and choose an opening later.</p>}
      <Button variant="secondary" onClick={() => { setOpeningSheet(false); if (!openings.length) { setGoal('rebook'); setSegment('consented_clients'); setServiceId(null); setStep(2); } }}>Continue without an opening</Button>
    </Sheet>
  </main>;
}
