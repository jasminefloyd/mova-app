import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, ScreenHeader, StatusChip, TextArea, TextField, Toggle } from '../../components';
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

  return <main className="mova-page mova-concierge-page mova-concierge-board">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'growth'))} backLabel={t('screens.concierge.backToRevenue')} trailing={<Link className="mova-concierge-board__teach" to={operatorUrl(businessId, 'growth/concierge/setup')}>{t('screens.concierge.teach')}</Link>} />
    <div className="mova-concierge-board__head">
      <h1>{t('concierge.title')}</h1>
      {!loading && !error && <p className="mova-concierge-board__status">
        <span className={`mova-concierge-board__dot${on ? ' is-on' : ''}`} aria-hidden="true" />
        {on ? t('screens.concierge.statusOn', { name: artistName ?? t('screens.concierge.yourAssistant') }) : t('screens.concierge.statusPaused')}
      </p>}
    </div>
    {loading ? <p role="status" aria-busy="true">{t('concierge.loading')}</p>
      : error ? <ErrorState title={t('concierge.error')} retryLabel={t('concierge.retry')} onRetry={() => void load()} />
      : <>
        <div className="mova-concierge-board__stats">
          {(['handled24h', 'booked30d', 'averageReply30d'] as const).map((key) => <Card key={key} className="mova-concierge-board__stat">
            <strong>{key === 'handled24h' ? metrics?.handled_24h ?? 0 : key === 'booked30d' ? metrics?.booked_30d ?? 0 : metrics?.average_reply_minutes == null ? '—' : t('screens.concierge.averageMinutes', { count: metrics.average_reply_minutes })}</strong><span>{t(`screens.concierge.${key}`)}</span>
          </Card>)}
        </div>

        <section className="mova-concierge-board__section" aria-labelledby="concierge-needs">
          <h2 id="concierge-needs" className="mova-overline">{t('screens.concierge.needsYou', { count: handoffs.length })}</h2>
          {handoffs.length
            ? <ul className="mova-concierge-list mova-concierge-list--needs">{handoffs.map((item) => {
              const conversation = data?.conversations.find((row) => row.id === item.conversation_id);
              return <li key={item.id}>
                <Link className="mova-concierge-handoff" to={operatorUrl(businessId, `growth/concierge/${item.conversation_id}`)}>
                  <span className="mova-list-row__copy">
                    <strong>{handoffType(item.type)} · {conversation?.mova_clients?.display_name ?? t('concierge.clientLabel')}</strong>
                    <small>{conversation ? channelName(conversation.channel) : ''} · {item.summary}</small>
                    <small>{new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at))}</small>
                  </span>
                  <span className="mova-concierge-decide">{t('concierge.decide')}</span>
                </Link>
              </li>;
            })}</ul>
            : <EmptyState title={t('concierge.empty')} />}
        </section>

        <section className="mova-concierge-board__section" aria-labelledby="concierge-handled">
          <h2 id="concierge-handled" className="mova-overline">{t('concierge.handledForYou')}</h2>
          <Card className="mova-concierge-handled">
            {handled.map((row) => <Link key={row.id} to={operatorUrl(businessId, `growth/concierge/${row.id}`)}>
              <span><strong>{row.mova_clients?.display_name ?? t('concierge.pageVisitor')}</strong><small>{channelName(row.channel)} · {row.locale === 'es-US' ? t('onboarding.spanish') : t('onboarding.english')}</small></span>
              <StatusChip status="info">{conversationStatus(row.status)}</StatusChip>
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
  useEffect(() => { setKnowledge(data?.knowledge ?? []); }, [data?.knowledge]);

  const knowledgeKind = (value: string) => t(`concierge.knowledgeKinds.${({ faq: 'faq', prep: 'prep', policy: 'policy', location_detail: 'locationDetail' } as Record<string, string>)[value] ?? 'other'}`);
  const knowledgeStatus = (value: string) => t(`concierge.knowledgeStatus.${({ draft: 'draft', active: 'active', archived: 'archived' } as Record<string, string>)[value] ?? 'other'}`);
  const channelName = (value: string) => t(`concierge.channelLabels.${({ web_chat: 'webChat', sms: 'sms', missed_call: 'missedCall', instagram: 'instagram' } as Record<string, string>)[value] ?? 'unknown'}`);

  const saveSettings = async (patch: { channels?: Record<string, boolean>; permissions?: Record<string, boolean>; paused?: boolean }) => {
    if (!client || !businessId || !data) return;
    setBusy(true); setNotice('');
    try {
      await invoke(client, businessId, { action: 'save-settings', channels: patch.channels ?? data.settings.channels, permissions: patch.permissions ?? data.settings.permissions, languages: ['en-US', 'es-US'] });
      await load();
    } catch {
      setNotice(t('concierge.error'));
    } finally {
      setBusy(false);
    }
  };

  const pauseAll = async (paused: boolean) => {
    if (!client || !businessId) return;
    setBusy(true); setNotice('');
    try {
      await invoke(client, businessId, { action: paused ? 'pause' : 'unpause' });
      if (!paused) setNotice(t('concierge.enabled'));
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
            {CHANNELS.map((channel) => <Toggle key={channel} label={channelName(channel)} description={t(channel === "sms" ? "screens.conciergeSetup.smsNumber" : data?.settings.channels[channel] ? "screens.conciergeSetup.on" : "screens.conciergeSetup.off")} checked={data?.settings.channels[channel] ?? false} disabled={busy} onChange={(value) => void saveSettings({ channels: { ...data?.settings.channels, [channel]: value } })} />)}
          </Card>
        </section>

        <section className="mova-concierge-board__section" aria-labelledby="setup-alone">
          <h2 id="setup-alone" className="mova-overline">{t('screens.conciergeSetup.aloneTitle')}</h2>
          <Card className="mova-concierge-board__rows">
            {PERMISSIONS.map((permission) => <Toggle key={permission} label={t(`screens.conciergeSetup.permission.${permission}`)} checked={data?.settings.permissions[permission] ?? false} disabled={busy} onChange={(value) => void saveSettings({ permissions: { ...data?.settings.permissions, [permission]: value } })} />)}
            <div className="mova-concierge-board__fixed"><span>{t('screens.conciergeSetup.alwaysYou')}</span><span>{t('screens.conciergeSetup.alwaysYouValue')}</span></div>
          </Card>
        </section>

        <section className="mova-concierge-board__section" aria-labelledby="setup-knows">
          <h2 id="setup-knows" className="mova-overline">{t('screens.conciergeSetup.knowsTitle')}</h2>
          <Card className="mova-concierge-board__rows">
            <div className="mova-concierge-board__fixed"><span>{t('screens.conciergeSetup.faqs')}</span><span>{t('screens.conciergeSetup.answerCount', { count: knowledge.length })}</span></div>
            <div className="mova-concierge-board__fixed"><span>{t('screens.conciergeSetup.locationDetails')}</span><span>{t('screens.conciergeSetup.locationDetailsValue')}</span></div>
            <div className="mova-concierge-board__fixed"><span>{t('screens.conciergeSetup.tone')}</span><span>{t('screens.conciergeSetup.toneValue')}</span></div>
          </Card>
        </section>

        <section className="mova-concierge-board__section" aria-labelledby="setup-edit">
          <h2 id="setup-edit" className="mova-overline">{t('screens.conciergeSetup.editTitle')}</h2>
          <Card className="mova-concierge-board__rows">
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
        </section>

        <section className="mova-concierge-board__section" aria-labelledby="setup-pause">
          <h2 id="setup-pause" className="mova-overline">{t('screens.conciergeSetup.pauseTitle')}</h2>
          <Card className="mova-concierge-board__rows">
            <p className="mova-report-note">{t('concierge.setupIntro')}</p>
            <Toggle label={t('concierge.globalPause')} checked={data?.settings.globally_paused ?? true} disabled={busy} onChange={(value) => void pauseAll(value)} />
          </Card>
        </section>
        {notice && <p role="status">{notice}</p>}
      </>}
  </main>;
}

export default ConciergeInboxPage;
