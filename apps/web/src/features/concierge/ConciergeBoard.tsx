import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, Icon, ScreenHeader, TextArea, TextField, Toggle } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { invoke, useConcierge } from './ConciergePages';
import './concierge-board.css';

type Knowledge = { id: string; kind: string; question: string; answer_en: string; answer_es: string | null; status: string };
type ChannelKey = 'instagram' | 'sms' | 'missed_call' | 'web_chat';
type PermissionKey = 'answer' | 'book_instant' | 'request_salon' | 'reschedule';

const CHANNELS: ChannelKey[] = ['instagram', 'sms', 'missed_call', 'web_chat'];
const PERMISSIONS: PermissionKey[] = ['answer', 'book_instant', 'request_salon', 'reschedule'];

// Board 40: Concierge inbox. Metrics are computed from this artist's stored conversations, bookings and replies.
export function ConciergeInboxPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, data, loading, error, load } = useConcierge();
  const [artistName, setArtistName] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState(false);

  useEffect(() => {
    if (!client || !businessId) return;
    void client.from('mova_artist_profiles').select('display_name').eq('artist_business_id', businessId).maybeSingle()
      .then(({ data: row }) => setArtistName(row?.display_name ?? null));
  }, [client, businessId]);

  const channelName = (value: string) => t(`concierge.channelLabels.${({ web_chat: 'webChat', sms: 'sms', missed_call: 'missedCall', instagram: 'instagram' } as Record<string, string>)[value] ?? 'unknown'}`);
  const conversationStatus = (value: string) => t(`concierge.conversationStatus.${({ handled: 'handled', needs_you: 'needsYou', closed: 'closed' } as Record<string, string>)[value] ?? 'unknown'}`);
  const handoffType = (value: string) => t(`concierge.handoffTypes.${({ quote: 'quote', exception: 'exception', complaint: 'complaint' } as Record<string, string>)[value] ?? 'other'}`);
  const on = Boolean(data?.settings.enabled && !data.settings.globally_paused);
  const metrics = data?.metrics;
  const handoffs = data?.handoffs ?? [];
  const handled = (data?.conversations ?? []).filter((row) => row.status !== 'needs_you').slice(0, 10);
  const replySeconds = metrics?.average_reply_seconds;
  const replyTime = replySeconds == null ? '—' : replySeconds < 60
    ? t('screens.concierge.averageSeconds', { count: replySeconds })
    : t('screens.concierge.averageMinutes', { count: Math.round(replySeconds / 60) });
  const shortTime = (value: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', hour: 'numeric' }).format(new Date(value));
  const waitingMinutes = (value: string) => Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  const pauseAssistant = async () => {
    if (!on || !client || !businessId) return;
    setPausing(true);
    setPauseError(false);
    try { await invoke(client, businessId, { action: 'pause' }); await load(); }
    catch { setPauseError(true); }
    finally { setPausing(false); }
  };

  return <main className="mova-page mova-concierge-page mova-concierge-board">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'growth'))} backLabel={t('screens.concierge.backToRevenue')} trailing={<Link className="mova-concierge-board__teach" to={operatorUrl(businessId, 'growth/concierge/setup')}>{t('screens.concierge.teach')}</Link>} />
    <div className="mova-concierge-board__head">
      <h1>{t('concierge.title')}</h1>
      {!loading && !error && <button type="button" className={`mova-concierge-board__status${on ? ' is-on' : ' is-paused'}`} aria-label={on ? t('screens.concierge.pauseAssistant') : t('screens.concierge.statusPaused')} disabled={!on || pausing} onClick={() => void pauseAssistant()}>
        <span className={`mova-concierge-board__dot${on ? ' is-on' : ''}`} aria-hidden="true" />
        {on ? t('screens.concierge.statusOn', { name: artistName ?? t('screens.concierge.yourAssistant') }) : t('screens.concierge.statusPaused')}
      </button>}
    </div>
    {pauseError && <p role="status">{t('concierge.error')}</p>}
    {loading ? <p role="status" aria-busy="true">{t('concierge.loading')}</p>
      : error ? <ErrorState title={t('concierge.error')} retryLabel={t('concierge.retry')} onRetry={() => void load()} />
      : <>
        <div className="mova-concierge-board__stats">
          {(['handled24h', 'booked30d', 'averageReply30d'] as const).map((key) => <Card key={key} className="mova-concierge-board__stat">
            <strong>{key === 'handled24h' ? metrics?.handled_24h ?? 0 : key === 'booked30d' ? metrics?.booked_30d ?? 0 : replyTime}</strong><span>{t(`screens.concierge.${key}`)}</span>
          </Card>)}
        </div>

        <section className="mova-concierge-board__section" aria-labelledby="concierge-needs">
          <h2 id="concierge-needs" className="mova-overline">{t('screens.concierge.needsYou', { count: handoffs.length })}</h2>
          {handoffs.length
            ? <ul className="mova-concierge-list mova-concierge-list--needs">{handoffs.map((item) => {
              const conversation = data?.conversations.find((row) => row.id === item.conversation_id);
              return <li key={item.id}>
                <Link className="mova-concierge-handoff" to={operatorUrl(businessId, `growth/concierge/${item.conversation_id}`)}>
                  <span className="mova-concierge-handoff__icon"><Icon name={item.type === 'quote' ? 'message' : 'info'} size={19} /></span>
                  <span className="mova-list-row__copy mova-concierge-handoff__copy">
                    <strong>{handoffType(item.type)} · {conversation?.mova_clients?.display_name ?? t('concierge.clientLabel')}</strong>
                    <small>{conversation ? `${channelName(conversation.channel)} · ` : ''}{item.summary}</small>
                    <small>{conversation?.locale === 'es-US' ? t('onboarding.spanish') : t('onboarding.english')} · {t('screens.concierge.waitingMinutes', { count: waitingMinutes(item.created_at) })}</small>
                  </span>
                  {item.type === 'quote'
                    ? <span className="mova-concierge-handoff__next" aria-hidden="true"><Icon name="chevron" size={18} /></span>
                    : <span className="mova-concierge-decide">{t('concierge.decide')}</span>}
                </Link>
              </li>;
            })}</ul>
            : <EmptyState title={t('concierge.empty')} />}
        </section>

        <section className="mova-concierge-board__section" aria-labelledby="concierge-handled">
          <h2 id="concierge-handled" className="mova-overline">{t('concierge.handledForYou')}</h2>
          <Card className="mova-concierge-handled">
            {handled.map((row) => <Link key={row.id} to={operatorUrl(businessId, `growth/concierge/${row.id}`)}>
              <span className="mova-concierge-handled__copy"><strong>{row.mova_clients?.display_name ?? t('concierge.pageVisitor')} · {channelName(row.channel)} · {conversationStatus(row.status)}</strong><small>{row.last_message_preview || (row.locale === 'es-US' ? t('onboarding.spanish') : t('onboarding.english'))} · {shortTime(row.last_message_at)}</small></span>
              <span className="mova-concierge-outcome">{t('screens.concierge.answered')}</span>
            </Link>)}
            {handled.length === 0 && <EmptyState title={t('concierge.empty')} />}
          </Card>
        </section>
      </>}
  </main>;
}

// Board 43: Teach your concierge. Toggles save through the concierge settings; answers are edited below.
export function ConciergeSetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, data, loading, error, load } = useConcierge();
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [form, setForm] = useState({ id: '', kind: 'faq', question: '', answer_en: '', answer_es: '' });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [locations, setLocations] = useState<Array<{ name: string; booking_mode: string }>>([]);
  useEffect(() => { setKnowledge(data?.knowledge ?? []); }, [data?.knowledge]);
  useEffect(() => {
    if (!client || !businessId) return;
    void client.from('mova_locations').select('name,booking_mode').eq('artist_business_id', businessId).eq('is_active', true).order('created_at')
      .then(({ data: rows }) => setLocations(rows ?? []));
  }, [businessId, client]);

  const knowledgeKind = (value: string) => t(`concierge.knowledgeKinds.${({ faq: 'faq', prep: 'prep', policy: 'policy', location_detail: 'locationDetail' } as Record<string, string>)[value] ?? 'other'}`);
  const knowledgeStatus = (value: string) => t(`concierge.knowledgeStatus.${({ draft: 'draft', active: 'active', archived: 'archived' } as Record<string, string>)[value] ?? 'other'}`);
  const permissionLabel = (permission: PermissionKey) => {
    if (permission === 'book_instant') return t('screens.conciergeSetup.permission.book_instant', { location: locations.find((location) => location.booking_mode === 'instant')?.name ?? t('screens.conciergeSetup.anyInstantLocation') });
    if (permission === 'request_salon') return t('screens.conciergeSetup.permission.request_salon', { location: locations.find((location) => location.booking_mode === 'request')?.name ?? t('screens.conciergeSetup.anyRequestLocation') });
    return t(`screens.conciergeSetup.permission.${permission}`);
  };
  const knowledgeAnswers = knowledge.filter((item) => item.kind === 'faq' || item.kind === 'prep');
  const languages = (data?.settings.languages ?? ['en-US', 'es-US']).map((language) => language === 'es-US' ? 'ES' : 'EN').join(' + ');
  const tone = data?.settings.tone === 'warm' ? t('screens.conciergeSetup.toneWarm') : data?.settings.tone ?? t('screens.conciergeSetup.toneWarm');

  const saveSettings = async (patch: { channels?: Record<string, boolean>; permissions?: Record<string, boolean>; paused?: boolean }) => {
    if (!client || !businessId || !data) return;
    setBusy(true); setNotice('');
    try {
      await invoke(client, businessId, { action: 'save-settings', channels: patch.channels ?? data.settings.channels, permissions: patch.permissions ?? data.settings.permissions, languages: data.settings.languages ?? ['en-US', 'es-US'] });
      await load();
    } catch {
      setNotice(t('concierge.error'));
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !businessId) return;
    setBusy(true); setNotice('');
    try {
      const result = await invoke(client, businessId, { action: 'save-knowledge', ...form });
      setKnowledge((rows) => [result.knowledge, ...rows.filter((row) => row.id !== result.knowledge.id)]);
      setForm({ id: '', kind: 'faq', question: '', answer_en: '', answer_es: '' });
      setNotice(t('concierge.knowledgeSaved'));
    } catch {
      setNotice(t('concierge.error'));
    } finally {
      setBusy(false);
    }
  };

  return <main className="mova-page mova-concierge-page mova-concierge-board">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'growth/concierge'))} backLabel={t('screens.concierge.backToInbox')} />
    <div className="mova-concierge-board__head">
      <h1>{t('screens.conciergeSetup.title')}</h1>
      <p>{t('screens.conciergeSetup.intro')}</p>
    </div>
    {loading ? <p role="status" aria-busy="true">{t('concierge.loading')}</p>
      : error ? <ErrorState title={t('concierge.error')} retryLabel={t('concierge.retry')} onRetry={() => void load()} />
      : <>
        <section className="mova-concierge-board__section" aria-labelledby="setup-where">
          <h2 id="setup-where" className="mova-overline">{t('screens.conciergeSetup.whereTitle')}</h2>
          <Card className="mova-concierge-board__rows">
            {CHANNELS.map((channel) => {
              const enabled = data?.settings.channels[channel] ?? false;
              const label = t(`screens.conciergeSetup.channel.${({ instagram: 'instagram', sms: 'sms', missed_call: 'missedCall', web_chat: 'webChat' } as Record<string, string>)[channel]}`);
              const value = channel === 'sms' ? data?.sms_number ?? t('screens.conciergeSetup.notAssigned') : channel === 'instagram' && enabled ? t('screens.conciergeSetup.connected') : enabled ? t('screens.conciergeSetup.on') : t('screens.conciergeSetup.off');
              return <button key={channel} type="button" className="mova-concierge-board__fixed mova-concierge-board__channel" aria-pressed={enabled} disabled={busy} onClick={() => void saveSettings({ channels: { ...data?.settings.channels, [channel]: !enabled } })}>
                <span>{label}</span><span>{value}</span>
              </button>;
            })}
          </Card>
        </section>

        <section className="mova-concierge-board__section" aria-labelledby="setup-alone">
          <h2 id="setup-alone" className="mova-overline">{t('screens.conciergeSetup.aloneTitle')}</h2>
          <Card className="mova-concierge-board__rows">
            {PERMISSIONS.map((permission) => <Toggle key={permission} label={permissionLabel(permission)} checked={data?.settings.permissions[permission] ?? false} disabled={busy} onChange={(value) => void saveSettings({ permissions: { ...data?.settings.permissions, [permission]: value } })} />)}
            <div className="mova-concierge-board__fixed mova-concierge-board__fixed--locked"><span>{t('screens.conciergeSetup.alwaysYou')}</span><span><Icon name="lock" size={14} />{t('screens.conciergeSetup.alwaysYouValue')}</span></div>
          </Card>
        </section>

        <section className="mova-concierge-board__section" aria-labelledby="setup-knows">
          <h2 id="setup-knows" className="mova-overline">{t('screens.conciergeSetup.knowsTitle')}</h2>
          <Card className="mova-concierge-board__rows">
            <button type="button" className="mova-concierge-board__fixed mova-concierge-board__knowledge-link" aria-expanded={knowledgeOpen} onClick={() => setKnowledgeOpen((open) => !open)}><span>{t('screens.conciergeSetup.faqs')}</span><span>{t('screens.conciergeSetup.answerCount', { count: knowledgeAnswers.length })}</span></button>
            <div className="mova-concierge-board__fixed"><span>{t('screens.conciergeSetup.locationDetails')}</span><span>{t('screens.conciergeSetup.locationDetailsValue')}</span></div>
            <div className="mova-concierge-board__fixed"><span>{t('screens.conciergeSetup.tone')}</span><span>{t('screens.conciergeSetup.toneValue', { tone, languages })}</span></div>
          </Card>
        </section>

        {knowledgeOpen && <section className="mova-concierge-board__section" aria-labelledby="setup-edit">
          <h2 id="setup-edit" className="mova-overline">{t('screens.conciergeSetup.editTitle')}</h2>
          <Card className="mova-concierge-board__rows mova-concierge-board__knowledge-editor">
            <form className="mova-concierge-form" onSubmit={(event) => void save(event)}>
              <label className="mova-field"><span className="mova-field__label">{t('concierge.kind')}</span>
                <select className="mova-input" value={form.kind} onChange={(event) => setForm((value) => ({ ...value, kind: event.currentTarget.value }))}>
                  <option value="faq">{t('concierge.faq')}</option><option value="prep">{t('concierge.prep')}</option><option value="policy">{t('concierge.policy')}</option><option value="location_detail">{t('concierge.location')}</option>
                </select></label>
              <TextField label={t('concierge.question')} required maxLength={500} value={form.question} onChange={(event) => setForm((value) => ({ ...value, question: event.currentTarget.value }))} />
              <TextArea label={t('concierge.answerEn')} required maxLength={3000} value={form.answer_en} onChange={(event) => setForm((value) => ({ ...value, answer_en: event.currentTarget.value }))} />
              <TextArea label={t('concierge.answerEs')} maxLength={3000} value={form.answer_es} onChange={(event) => setForm((value) => ({ ...value, answer_es: event.currentTarget.value }))} />
              <Button type="submit" disabled={busy}>{t('concierge.saveKnowledge')}</Button>
            </form>
            {knowledge.length
              ? <ul className="mova-revenue-list">{knowledge.map((item) => <li key={item.id} className="mova-revenue-list__item"><span><strong>{item.question}</strong><small>{knowledgeKind(item.kind)} · {knowledgeStatus(item.status)}</small></span><Button variant="ghost" onClick={() => setForm({ id: item.id, kind: item.kind, question: item.question, answer_en: item.answer_en, answer_es: item.answer_es ?? '' })}>{t('settings.edit')}</Button></li>)}</ul>
              : <EmptyState title={t('concierge.knowledgeEmpty')} />}
          </Card>
        </section>}

        {notice && <p role="status">{notice}</p>}
      </>}
  </main>;
}

export default ConciergeInboxPage;
