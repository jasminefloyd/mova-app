import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState } from '../../components';
import { publicEnv } from '../../lib/env';

type View = { stylist: string; handle: string; starts_at: string; ends_at: string; time_zone: string; location: string; booking_mode: 'instant' | 'request'; service: string | null; price_minor: number | null };
type State = 'loading' | 'open' | 'claimed' | 'taken' | 'expired' | 'invalid' | 'error';

/** Task 5.1, board 31d: a texted client claims a spot that just opened. First to claim gets it. */
export function ClaimSlotPage() {
  const { token = '' } = useParams();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>('loading');
  const [view, setView] = useState<View | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (action: 'view' | 'claim') => {
    const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/slot-claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token }) });
    const json = await response.json().catch(() => null);
    if (!response.ok && response.status !== 422) throw new Error('FAILED');
    return (json?.data ?? { status: 'invalid' }) as { status: State; slot?: View; appointment_status?: string | null };
  }, [token]);

  useEffect(() => { void (async () => { try { const result = await call('view'); setView(result.slot ?? null); setState(result.status); } catch { setState('error'); } })(); }, [call]);
  const claim = async () => {
    setBusy(true);
    try { const result = await call('claim'); setView(result.slot ?? view); setMode(result.appointment_status ?? null); setState(result.status); }
    catch { setState('error'); } finally { setBusy(false); }
  };

  const locale = i18n.resolvedLanguage === 'es-US' ? 'es-US' : 'en-US';
  const first = view?.stylist.split(/\s+/)[0] ?? '';
  const date = view ? new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: view.time_zone }).format(new Date(view.starts_at)) : '';
  const range = view ? `${new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: view.time_zone }).format(new Date(view.starts_at))} – ${new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: view.time_zone }).format(new Date(view.ends_at))}` : '';
  const price = view?.price_minor != null ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(view.price_minor / 100) : null;
  const bookLink = view?.handle ? `/a/${encodeURIComponent(view.handle)}/book` : '/';

  return <main className="mova-page mova-claim">
    <p className="mova-wordmark">mova.</p>
    {state === 'loading' && <p role="status" aria-busy="true">{t('seat.loading')}</p>}
    {state === 'error' && <ErrorState title={t('seat.error')} retryLabel={t('seat.retry')} onRetry={() => window.location.reload()} />}
    {state === 'invalid' && <Card><h1>{t('seat.invalidTitle')}</h1><p>{t('seat.invalidBody')}</p></Card>}
    {view && state === 'open' && <>
      <header className="mova-claim__head"><span className="mova-claim__badge">{t('seat.justOpened')}</span><h1>{t('seat.with', { date, name: first })}</h1></header>
      <Card className="mova-claim__details">
        <dl>
          <div><dt>{t('seat.when')}</dt><dd>{date} · {range}</dd></div>
          {view.service && <div><dt>{t('seat.service')}</dt><dd>{view.service}{price ? ` · ${price}` : ''}</dd></div>}
          <div><dt>{t('seat.where')}</dt><dd>{view.location}</dd></div>
        </dl>
        <p className="mova-claim__one">{t('seat.oneSpot')}</p>
      </Card>
      <Button type="button" loading={busy} onClick={() => void claim()}>{view.booking_mode === 'request' ? t('seat.request') : t('seat.claim')}</Button>
      <Link className="mova-claim__other" to={bookLink}>{t('seat.otherTimes')}</Link>
    </>}
    {view && state === 'claimed' && <Card className="mova-claim__done" >
      <h1>{mode === 'pending_artist' ? t('seat.requestedTitle') : t('seat.claimedTitle')}</h1>
      <p role="status">{mode === 'pending_artist' ? t('seat.requestedBody', { name: first, date, range }) : t('seat.claimedBody', { name: first, date, range })}</p>
    </Card>}
    {view && (state === 'taken' || state === 'expired') && <Card className="mova-claim__taken">
      <span className="mova-claim__badge is-taken">{state === 'taken' ? t('seat.justTaken') : t('seat.ended')}</span>
      <h1>{state === 'taken' ? t('seat.takenTitle') : t('seat.endedTitle')}</h1>
      <p>{t('seat.takenBody', { name: first })}</p>
      <Link className="mova-button mova-button--primary" to={bookLink}>{t('seat.seeTimes')}</Link>
    </Card>}
  </main>;
}
export default ClaimSlotPage;
