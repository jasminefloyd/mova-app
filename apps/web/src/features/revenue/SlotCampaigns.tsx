import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, StatusChip } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';

type Candidate = { id: string; status: string; wave: number; rank: number; reasons: string[]; mova_clients: { display_name: string } | null };
type Campaign = {
  id: string; status: string; starts_at: string; ends_at: string; expires_at: string; current_wave: number; wave_minutes: number; next_wave_at: string | null; filled_at: string | null; value_minor: number | null;
  mova_locations: { name?: string } | null; mova_services: { name?: string; base_price_minor?: number } | null; mova_slot_candidates: Candidate[];
  mova_slot_campaign_copy: { sms_example: string; taken_message: string; social_caption: string; approved_at: string | null } | Array<{ sms_example: string; taken_message: string; social_caption: string; approved_at: string | null }> | null;
};

/** Task 5.1: fill open slots (31), review a campaign (31b) and follow it live (31c). */
export function SlotCampaigns() {
  const { t, i18n } = useTranslation();
  const { client, businessId } = useArtistBusiness();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [outbound, setOutbound] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const call = useCallback(async (payload: Record<string, unknown>) => {
    if (!client || !businessId) throw new Error('IDENTITY_MISSING');
    const { data, error: fnError } = await client.functions.invoke<{ data?: Record<string, unknown> }>('slot-campaign', { body: payload, headers: { 'x-mova-artist-business-id': businessId } });
    if (fnError || !data?.data) throw new Error('FAILED');
    return data.data;
  }, [client, businessId]);
  const load = useCallback(async () => {
    try { const result = await call({ action: 'list' }); setCampaigns((result.campaigns ?? []) as Campaign[]); setOutbound(result.outboundEnabled === true); setError(false); }
    catch { setError(true); } finally { setLoaded(true); }
  }, [call]);
  useEffect(() => { void load(); }, [load]);
  const act = async (action: string, id: string) => { setBusy(`${action}:${id}`); try { await call({ action, slot_event_id: id }); await load(); } catch { setError(true); } finally { setBusy(null); } };

  const when = (iso: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const money = (minor: number | null | undefined) => minor == null ? null : new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(minor / 100);
  const status = (value: string) => t(`revenue.campaignStatus.${({ gap_found: 'gapFound', drafting: 'drafting', needs_approval: 'needsApproval', live: 'live', filled: 'filled', expired: 'expired', cancelled: 'cancelled' } as Record<string, string>)[value] ?? 'unknown'}`);
  const counts = (['needs_approval', 'live', 'filled'] as const).map((key) => [key, campaigns.filter((item) => item.status === key).length] as const);
  const recovered = campaigns.filter((item) => item.status === 'filled').reduce((sum, item) => sum + (item.value_minor ?? 0), 0);

  if (!loaded) return <p role="status" aria-busy="true">{t('revenue.loading')}</p>;
  return <div className="mova-slots">
    {!outbound && <p className="mova-slots__note">{t('revenue.seat.outboundOff')}</p>}
    {error && <p role="alert">{t('revenue.seat.error')}</p>}
    {campaigns.length > 0 && <div className="mova-revenue-kpis">
      <Card className="is-highlight"><strong>{money(recovered)}</strong><span>{t('revenue.seat.recovered')}</span></Card>
      {counts.map(([key, value]) => <Card key={key}><strong>{value}</strong><span>{status(key)}</span></Card>)}
    </div>}
    {campaigns.length === 0 ? <EmptyState title={t('revenue.campaignEmpty')} detail={t('revenue.campaignEmptyDetail')} /> : <ul className="mova-slots__list">{campaigns.map((campaign) => {
      const copy = Array.isArray(campaign.mova_slot_campaign_copy) ? campaign.mova_slot_campaign_copy[0] : campaign.mova_slot_campaign_copy;
      const candidates = [...(campaign.mova_slot_candidates ?? [])].sort((a, b) => a.rank - b.rank);
      const waves = [1, 2, 3].map((wave) => candidates.filter((item) => item.wave === wave)).filter((list) => list.length);
      const claimed = candidates.find((item) => item.status === 'claimed');
      const expanded = open === campaign.id || campaign.status === 'needs_approval';
      const service = campaign.mova_services?.name;
      return <li key={campaign.id}><Card className={`mova-slots__card is-${campaign.status}`}>
        <div className="mova-slots__head">
          <span><strong>{when(campaign.starts_at)}</strong><small>{[campaign.mova_locations?.name, service, money(campaign.mova_services?.base_price_minor ?? campaign.value_minor)].filter(Boolean).join(' · ')}</small></span>
          <StatusChip status={campaign.status === 'live' ? 'live' : campaign.status === 'filled' ? 'confirmed' : campaign.status === 'needs_approval' ? 'needs-approval' : 'pending'}>{campaign.status === 'live' ? t('revenue.seat.liveWave', { wave: campaign.current_wave, waves: waves.length }) : status(campaign.status)}</StatusChip>
        </div>
        {claimed && <p className="mova-slots__filled">{t('revenue.seat.bookedBy', { name: claimed.mova_clients?.display_name ?? '' })}{campaign.filled_at ? ` · ${time(campaign.filled_at)}` : ''}</p>}
        {expanded && <>
          {campaign.status === 'needs_approval' && <>
            <p className="mova-slots__fit"><strong>{t('revenue.seat.fit', { count: candidates.length })}</strong> {t('revenue.seat.fitDetail', { waves: waves.map((list) => list.length).join(', '), minutes: campaign.wave_minutes })}</p>
            {copy && <div className="mova-slots__copy"><span>{t('revenue.seat.textMessage')}</span><p>{copy.sms_example}</p><small>{t('revenue.seat.takenNote', { text: copy.taken_message })}</small></div>}
          </>}
          <ol className="mova-slots__timeline" aria-label={t('revenue.seat.timeline')}>
            {waves.map((list, index) => {
              const wave = index + 1;
              const sent = list.filter((item) => item.status !== 'planned');
              return <li key={wave} className={wave <= campaign.current_wave ? 'is-done' : ''}>
                <strong>{wave <= campaign.current_wave ? t('revenue.seat.waveSent', { wave, count: sent.length }) : t('revenue.seat.wavePlanned', { wave, count: list.length })}</strong>
                <small>{list.map((item) => item.mova_clients?.display_name?.split(' ').map((part, i) => (i ? `${part[0]}.` : part)).join(' ') ?? '').join(', ')}
                  {wave === campaign.current_wave + 1 && campaign.status === 'live' && campaign.next_wave_at ? ` · ${t('revenue.seat.sendsAt', { time: time(campaign.next_wave_at) })}` : ''}</small>
              </li>;
            })}
          </ol>
        </>}
        <div className="mova-revenue-actions">
          {campaign.status === 'needs_approval' && <Button disabled={!outbound || busy !== null} loading={busy === `approve:${campaign.id}`} onClick={() => void act('approve', campaign.id)}>{t('revenue.seat.approve')}</Button>}
          {campaign.status === 'live' && campaign.current_wave < waves.length && <Button variant="secondary" disabled={!outbound || busy !== null} loading={busy === `send-next-wave:${campaign.id}`} onClick={() => void act('send-next-wave', campaign.id)}>{t('revenue.seat.sendNext', { wave: campaign.current_wave + 1 })}</Button>}
          {['needs_approval', 'live', 'gap_found', 'drafting'].includes(campaign.status) && <Button variant="ghost" disabled={busy !== null} onClick={() => void act('cancel', campaign.id)}>{t('revenue.seat.stop')}</Button>}
          {campaign.status !== 'needs_approval' && <Button variant="ghost" onClick={() => setOpen(open === campaign.id ? null : campaign.id)}>{open === campaign.id ? t('revenue.seat.hide') : t('revenue.seat.details')}</Button>}
        </div>
        {campaign.status === 'needs_approval' && <small className="mova-slots__ends">{t('revenue.seat.ends')}</small>}
      </Card></li>;
    })}</ul>}
  </div>;
}
