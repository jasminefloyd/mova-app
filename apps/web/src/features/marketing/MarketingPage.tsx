import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button, Card, Checkbox, EmptyState, ErrorState, ScreenHeader, StatusChip, TextArea, TextField } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import './marketing.css';

type Channel = 'email' | 'social' | 'web_push' | 'wallet';
type Campaign = { id: string; name: string; goal: string; status: string; created_at: string; mova_marketing_campaign_channels?: Array<{ channel: Channel; status: string; error_code: string | null }> };
type Status = { campaigns: Campaign[]; channels: Record<Channel, { plan: boolean; platform: boolean; ready: boolean }>; delivery_enabled: boolean };
type Preview = { eligible: number | null; considered?: number; capped?: boolean; ready: boolean; reason: string | null };
const channelKeys: Channel[] = ['email', 'social', 'web_push', 'wallet'];
const call = async <T,>(client: ReturnType<typeof useArtistBusiness>['client'], businessId: string, body: Record<string, unknown>) => {
  if (!client) throw new Error('IDENTITY_REQUIRED');
  const { data, error } = await client.functions.invoke<{ data?: T }>('marketing-campaign', { body, headers: { 'x-mova-artist-business-id': businessId } });
  if (error || !data?.data) throw new Error('MARKETING_ACTION_FAILED');
  return data.data;
};

export default function MarketingPage() {
  const { t, i18n } = useTranslation(); const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState<Status | null>(null); const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [name, setName] = useState(''); const [goal, setGoal] = useState('fill_opening'); const [selected, setSelected] = useState<Channel[]>(['email']);
  const [subject, setSubject] = useState('A time just opened up'); const [copy, setCopy] = useState('I have an opening this week. Choose a time that works for you.');
  const [captions, setCaptions] = useState<Record<string, string>>({ instagram: 'A time just opened up. Book your next visit with me.', facebook: 'A time just opened up. Book your next visit with me.', google_business: 'A time just opened up. Book your next visit with me.' }); const [previews, setPreviews] = useState<Partial<Record<Channel, Preview>>>({});
  const [socialDestinations, setSocialDestinations] = useState<string[]>(['instagram','facebook','google_business']);
  const load = useCallback(async () => { if (!client || !businessId) return; setLoading(true); setFailed(false); try { setStatus(await call<Status>(client, businessId, { action: 'status' })); } catch { setFailed(true); } finally { setLoading(false); } }, [client, businessId]);
  useEffect(() => { if (!identityLoading && businessId) void load(); }, [identityLoading, businessId, load]);
  useEffect(() => { const update = () => setOnline(navigator.onLine); update(); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  const toggle = (channel: Channel) => setSelected((items) => items.includes(channel) ? items.filter((item) => item !== channel) : [...items, channel]);
  const preview = async () => { if (!businessId) return; setBusy(true); setMessage(''); try { const results = await Promise.all(selected.map(async (channel) => [channel, await call<Preview>(client, businessId, { action: 'preview', channel, goal })] as const)); setPreviews(Object.fromEntries(results)); } catch { setMessage(t('marketing.previewError')); } finally { setBusy(false); } };
  const save = async () => { if (!businessId || !selected.length || !name.trim()) { setMessage(t('marketing.validation')); return; } setBusy(true); setMessage(''); try {
    await call(client, businessId, { action: 'save', name, goal, channels: selected.map((channel) => ({ channel, content: channel === 'email' ? { subject, text: copy, cta: t('marketing.book') } : channel === 'social' ? { social_captions: captions, social_destinations: socialDestinations } : { text: copy, cta: t('marketing.book') } })) });
    setEditing(false); setName(''); setPreviews({}); setMessage(t('marketing.saved')); await load();
  } catch { setMessage(t('marketing.saveError')); } finally { setBusy(false); } };
  const cancel = async (id: string) => { if (!businessId) return; setBusy(true); try { await call(client, businessId, { action: 'cancel', id }); await load(); } catch { setMessage(t('marketing.saveError')); } finally { setBusy(false); } };
  const create = () => { setEditing(true); setMessage(''); setPreviews({}); };
  if (identityLoading || loading) return <main className="mova-page mova-marketing-page"><p role="status" aria-busy="true">{t('marketing.loading')}</p></main>;
  if (failed) return <main className="mova-page mova-marketing-page"><ErrorState title={t('marketing.loadError')} retryLabel={t('marketing.retry')} onRetry={() => void load()} /></main>;
  if (!status || !businessId) return <main className="mova-page mova-marketing-page"><p role="alert">{t('marketing.identityError')}</p></main>;
  return <main className="mova-page mova-marketing-page">
    <ScreenHeader title={t('marketing.title')} onBack={() => navigate(operatorUrl(businessId, 'growth'))} backLabel={t('revenue.title')} />
    {!online && <p className="mova-offline" role="status">{t('marketing.offline')}</p>}
    {editing ? <>
      <header className="mova-marketing-heading"><p className="mova-overline">{t('marketing.newCampaign')}</p><h1>{t('marketing.createTitle')}</h1><p>{t('marketing.intro')}</p></header>
      <Card><TextField label={t('marketing.campaignName')} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        <label className="mova-field"><span>{t('marketing.goalLabel')}</span><select value={goal} onChange={(event) => setGoal(event.target.value)}><option value="fill_opening">{t('marketing.goalOpening')}</option><option value="rebook">{t('marketing.goalRebook')}</option><option value="offer">{t('marketing.goalOffer')}</option><option value="showcase">{t('marketing.goalShowcase')}</option></select></label>
      </Card>
      <h2>{t('marketing.channels')}</h2><div className="mova-marketing-channels">{channelKeys.map((channel) => { const gate = status.channels[channel]; const active = selected.includes(channel); return <Card key={channel} className="mova-marketing-channel">
        <label><input type="checkbox" checked={active} disabled={!gate.plan} onChange={() => toggle(channel)} /><span><strong>{t(`marketing.channel.${channel}`)}</strong><small>{t(`marketing.channelDetail.${channel}`)}</small></span><StatusChip status={gate.ready ? 'live' : 'pending'}>{!gate.plan ? t('marketing.planLocked') : gate.ready ? t('marketing.available') : t('marketing.rolloutOff')}</StatusChip></label>
        {active && <div className="mova-marketing-channel__content">{channel === 'email' && <TextField label={t('marketing.subject')} value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} />} {channel === 'social' ? <><fieldset className="mova-marketing-destinations"><legend>{t('marketing.destinations')}</legend>{(['instagram','facebook','google_business'] as const).map((destination) => <Checkbox key={destination} label={t(`marketing.destination.${destination}`)} checked={socialDestinations.includes(destination)} onChange={(event) => setSocialDestinations((current) => event.target.checked ? [...current,destination] : current.filter((item) => item !== destination))} />)}</fieldset>{socialDestinations.map((destination) => <TextArea key={destination} label={t('marketing.captionFor', { channel: t(`marketing.destination.${destination}`) })} value={captions[destination] ?? ''} onChange={(event) => setCaptions((current) => ({ ...current, [destination]: event.target.value }))} maxLength={2200} />)}</> : channel !== 'email' && <TextArea label={t('marketing.message')} value={copy} onChange={(event) => setCopy(event.target.value)} maxLength={1000} />}
          {previews[channel] && <p className="mova-marketing-preview" role="status">{previews[channel]?.eligible === null ? t('marketing.audienceUnavailable') : t('marketing.audienceEligible', { count: previews[channel]?.eligible ?? 0 })}{previews[channel]?.capped ? ` · ${t('marketing.audienceCapped')}` : ''}{previews[channel]?.reason ? ` · ${t(`marketing.reason.${previews[channel]?.reason}`, { defaultValue: t('marketing.notReady') })}` : ''}</p>}
        </div>}
      </Card>; })}</div>
      <Card tone="warm"><strong>{t('marketing.safetyTitle')}</strong><p>{t('marketing.safetyDetail')}</p><p>{t('marketing.localTime')}</p></Card>
      {message && <p role="status">{message}</p>}
      <div className="mova-marketing-actions"><Button variant="secondary" disabled={busy || !online} onClick={() => void preview()}>{t('marketing.previewAudience')}</Button><Button disabled={busy || !online} loading={busy} onClick={() => void save()}>{t('marketing.saveDraft')}</Button></div>
      <Button variant="ghost" onClick={() => setEditing(false)}>{t('settings.close')}</Button>
    </> : <>
      <header className="mova-marketing-heading"><p className="mova-overline">{t('marketing.overline')}</p><h1>{t('marketing.title')}</h1><p>{t('marketing.intro')}</p></header>
      <Card tone="inverse" className="mova-marketing-hero"><h2>{t('marketing.heroTitle')}</h2><p>{t('marketing.heroDetail')}</p><Button variant="on-dark" onClick={create}>{t('marketing.createCampaign')}</Button></Card>
      <section><h2>{t('marketing.channels')}</h2><div className="mova-marketing-channel-list">{channelKeys.map((channel) => { const gate = status.channels[channel]; return <Card key={channel}><div className="mova-marketing-channel-summary"><div><h3>{t(`marketing.channel.${channel}`)}</h3><p>{t(`marketing.channelDetail.${channel}`)}</p></div><StatusChip status={gate.ready ? 'live' : 'pending'}>{!gate.plan ? t('marketing.planLocked') : gate.ready ? t('marketing.available') : t('marketing.rolloutOff')}</StatusChip></div>{channel === 'email' && <small>{t('marketing.emailPrereq')}</small>}{channel === 'social' && <small>{t('marketing.socialPrereq')}</small>}{channel === 'web_push' && <small>{t('marketing.pushPrereq')}</small>}{channel === 'wallet' && <small>{t('marketing.walletPrereq')}</small>}</Card>; })}</div></section>
      <section className="mova-marketing-campaign-section"><h2>{t('marketing.campaigns')}</h2>{status.campaigns.length ? <ul className="mova-marketing-campaigns">{status.campaigns.map((campaign) => <li key={campaign.id}><Card><div className="mova-marketing-campaign"><div><strong>{campaign.name}</strong><small>{t(`marketing.goalName.${campaign.goal}`, { defaultValue: campaign.goal })} · {new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(campaign.created_at))}</small></div><StatusChip status={campaign.status === 'sent' ? 'confirmed' : campaign.status === 'failed' ? 'cancelled' : 'pending'}>{t(`marketing.status.${campaign.status}`, { defaultValue: campaign.status })}</StatusChip></div><small>{(campaign.mova_marketing_campaign_channels ?? []).map((item) => t(`marketing.channel.${item.channel}`)).join(' · ')}</small>{['draft','scheduled'].includes(campaign.status) && <Button variant="secondary" disabled={busy || !online} onClick={() => void cancel(campaign.id)}>{t('marketing.cancel')}</Button>}</Card></li>)}</ul> : <EmptyState title={t('marketing.emptyTitle')} detail={t('marketing.emptyDetail')} action={<Button onClick={create}>{t('marketing.createCampaign')}</Button>} />}</section>
      {message && <p role="status">{message}</p>}
    </>}
  </main>;
}
