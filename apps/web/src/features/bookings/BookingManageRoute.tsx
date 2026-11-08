import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, ClientCard, ErrorState, Sheet, StatusChip } from '../../components';
import { clientProfilesEnabled, publicEnv } from '../../lib/env';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { QrCode } from '../identity/QrCode';

type Slot = { starts_at: string; ends_at: string; local_date: string; local_time: string; utc_offset: string; booking_mode: string };
type Booking = {
  id: string; status: string; starts_at: string; ends_at: string; service_id: string; service_ids?: string[]; service_name_snapshot: string; service_names?: string[];
  deposit_due_minor: number; location_id: string; cancellation_window_minutes: number; client_name: string; artist_business_id: string;
  artist?: { display_name: string; handle: string };
  reschedule_requested_starts_at: string | null; artist_suggested_starts_at: string | null;
  door_code: string | null; client_details: Record<string, string> | null;
  location?: { name: string; time_zone: string; booking_mode: string };
};

export function BookingManageRoute() {
  const { token = '' } = useParams();
  const { t, i18n } = useTranslation();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [clientCardUrl, setClientCardUrl] = useState('');
  const groupedDays = useMemo(() => [...new Set(slots.map((slot) => slot.local_date))], [slots]);

  const load = async () => {
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/booking-status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '' }, body: JSON.stringify({ token }),
      });
      const body = await response.json();
      if (!response.ok || !body.data) throw new Error();
      const bookingData = body.data.booking as Booking;
      setBooking(bookingData);
      const publicUrl = bookingData.artist?.handle ? `${window.location.origin}/a/${encodeURIComponent(bookingData.artist.handle)}/book` : '';
      let cardUrl = publicUrl;
      if (clientProfilesEnabled) {
        try {
          const client = createMovaSupabaseClient(); const { data: { session } } = await client.auth.getSession();
          if (session) {
            const cardResponse = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/client-card-token`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ artist_business_id: bookingData.artist_business_id }) });
            const cardResult = await cardResponse.json(); if (cardResponse.ok && typeof cardResult.data?.url === 'string') cardUrl = cardResult.data.url;
          }
        } catch { /* Keep the public booking link as the card QR fallback. */ }
      }
      setClientCardUrl(cardUrl);
      setError(false);
    } catch { setError(true); }
  };
  useEffect(() => { void load(); }, [token]);

  const cancel = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/booking-transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '' },
        body: JSON.stringify({ token, to_status: 'cancelled', reason: 'client_request' }),
      });
      if (!response.ok) throw new Error();
      setConfirmCancel(false);
      await load();
    } catch { setError(true); } finally { setBusy(false); }
  };

  const suggestionAction = async (suggestion_action: 'accept' | 'decline') => {
    setBusy(true);
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/booking-transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ token, suggestion_action }),
      });
      if (!response.ok) throw new Error();
      await load();
    } catch { setError(true); } finally { setBusy(false); }
  };

  const chooseReschedule = async () => {
    if (!booking) return;
    setBusy(true);
    try {
      const fromDate = new Intl.DateTimeFormat('en-CA', { timeZone: booking.location?.time_zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/availability-search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '' },
        body: JSON.stringify({ location_id: booking.location_id, service_ids: booking.service_ids??[booking.service_id], from_date: fromDate, days: 30 }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error();
      setSlots(body.data.groups?.[0]?.slots ?? []);
      setShowReschedule(true);
    } catch { setError(true); } finally { setBusy(false); }
  };

  const reschedule = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/booking-reschedule`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ token, new_starts_at: selected.starts_at }),
      });
      if (!response.ok) throw new Error();
      setShowReschedule(false);
      setSelected(null);
      await load();
    } catch { setError(true); } finally { setBusy(false); }
  };

  if (error) return <main className="mova-page"><ErrorState title={t('booking.manageError')} retryLabel={t('booking.retry')} onRetry={() => void load()} /></main>;
  if (!booking) return <main className="mova-page" aria-busy="true"><p role="status">{t('booking.loading')}</p></main>;

  const cancelDeadline = new Date(new Date(booking.starts_at).getTime() - booking.cancellation_window_minutes * 60_000);
  const policyAllowsChange = booking.status !== 'confirmed' || Date.now() <= cancelDeadline.getTime();
  const formattedStart = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'full', timeStyle: 'short', timeZone: booking.location?.time_zone }).format(new Date(booking.starts_at));
  const saveCardImage = async () => {
    const qr = document.querySelector<HTMLImageElement>('.mova-booking__qr .mova-generated-qr img');
    if (!qr) return;
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 700;
      const context = canvas.getContext('2d'); if (!context) throw new Error();
      const style = getComputedStyle(document.documentElement); context.fillStyle = style.getPropertyValue('--forest').trim(); context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = style.getPropertyValue('--surface-page').trim(); context.font = '800 52px Manrope'; context.fillText('mova', 64, 80);
      context.fillStyle = style.getPropertyValue('--mint').trim(); context.font = '700 22px "DM Sans"'; context.fillText(t('identity.clientCard'), 64, 155);
      context.fillStyle = style.getPropertyValue('--surface-page').trim(); context.font = '800 54px Manrope'; context.fillText(booking.client_name || t('identity.client'), 64, 245);
      context.fillStyle = style.getPropertyValue('--mint').trim(); context.font = '500 28px "DM Sans"'; context.fillText(t('identity.withStylist', { name: booking.artist?.display_name ?? t('identity.client') }), 64, 305);
      context.fillText(t('identity.nextAppointment', { date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: booking.location?.time_zone }).format(new Date(booking.starts_at)) }), 64, 365);
      context.drawImage(qr, 885, 190, 250, 250);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error()), 'image/png'));
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'mova-client-card.png'; link.click(); URL.revokeObjectURL(link.href);
    } catch { setError(true); }
  };

  return <main className="mova-page mova-booking">
    <header className="mova-booking__brand"><span className="mova-wordmark">mova</span></header>
    <StatusChip status={booking.status === 'confirmed' ? 'confirmed' : ['cancelled', 'declined', 'expired'].includes(booking.status) ? 'cancelled' : 'pending'}>{t(`booking.status.${booking.status}`, { defaultValue: booking.status })}</StatusChip>
    <h1>{booking.status === 'confirmed' ? t('identity.bookedWith', { name: booking.artist?.display_name ?? t('identity.client') }) : t('booking.manageTitle')}</h1>
    <Card>
      <h2>{booking.service_names?.join(' + ')||booking.service_name_snapshot}</h2>
      <p>{formattedStart}</p>
      <p>{booking.location?.name}</p>
      <p>{t(`booking.status.${booking.status}`)}</p>
      <p>{t('booking.depositDue')}: {new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: 'USD' }).format(booking.deposit_due_minor / 100)}</p>
      {booking.status === 'confirmed' && <p>{t('booking.cancelAllowedBefore', { time: new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short', timeZone: booking.location?.time_zone }).format(cancelDeadline) })}</p>}
      {booking.status === 'pending_artist' && booking.artist_suggested_starts_at && <section>
        <h2>{t('booking.stylistSuggestedTime')}</h2>
        <p>{new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'full', timeStyle: 'short', timeZone: booking.location?.time_zone }).format(new Date(booking.artist_suggested_starts_at))}</p>
        <div className="mova-actions"><Button loading={busy} type="button" onClick={() => void suggestionAction('accept')}>{t('booking.acceptSuggestion')}</Button><Button variant="secondary" loading={busy} type="button" onClick={() => void suggestionAction('decline')}>{t('booking.declineSuggestion')}</Button></div>
      </section>}
      {booking.status === 'confirmed' && booking.client_details && Object.entries(booking.client_details).map(([key, value]) => value && <p key={key}>{t(`locations.${key}`)}: {value}</p>)}
      {booking.status === 'confirmed' && booking.door_code && <p><strong>{t('locations.doorCode')}: {booking.door_code}</strong></p>}
      {booking.reschedule_requested_starts_at && <p role="status">{t('booking.reschedulePending')}</p>}
      <a href={`${publicEnv.VITE_SUPABASE_URL}/functions/v1/booking-status?format=ics&token=${encodeURIComponent(token)}`} download>{t('booking.addCalendar')}</a>
      {booking.status === 'confirmed' && policyAllowsChange && !booking.reschedule_requested_starts_at && <Button type="button" variant="secondary" loading={busy} onClick={() => void chooseReschedule()}>{t('booking.reschedule')}</Button>}
      {booking.status === 'confirmed' && !policyAllowsChange && <p role="note">{t('booking.changeWindowClosed')}</p>}
      {showReschedule && <section>
        <h2>{t('booking.chooseTime')}</h2>
        {groupedDays.map((date) => <div key={date}><h3>{date}</h3><div className="mova-time-options">{slots.filter((slot) => slot.local_date === date).map((slot) => <button className="mova-chip" key={slot.starts_at} aria-pressed={selected?.starts_at === slot.starts_at} type="button" onClick={() => setSelected(slot)}>{slot.local_time} {slot.utc_offset} {slot.booking_mode === 'request' ? t('booking.mode.request') : ''}</button>)}</div></div>)}
        {selected && <Button loading={busy} type="button" onClick={() => void reschedule()}>{t('booking.submitReschedule')}</Button>}
      </section>}
      {['pending_artist', 'pending_payment'].includes(booking.status) && <Button type="button" variant="destructive" loading={busy} onClick={() => setConfirmCancel(true)}>{t('booking.cancel')}</Button>}
      {booking.status === 'confirmed' && policyAllowsChange && <Button type="button" variant="destructive" loading={busy} onClick={() => setConfirmCancel(true)}>{t('booking.cancel')}</Button>}
    </Card>
    <section className="mova-booking__card-section"><h2>{t('identity.keepClientCard')}</h2><ClientCard name={booking.client_name || t('identity.client')} artist={booking.artist?.display_name ?? t('identity.client')} nextAppointment={t('identity.nextAppointment', { date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: booking.location?.time_zone }).format(new Date(booking.starts_at)) })}><div className="mova-booking__qr">{clientCardUrl ? <><QrCode value={clientCardUrl} label={t('identity.clientCardQr')} size={180}/><small>{t('identity.rebookCheckIn')}</small></> : <small>{t('identity.clientCardUnavailable')}</small>}</div></ClientCard><button type="button" className="mova-booking__save-image" disabled={!clientCardUrl} onClick={() => void saveCardImage()}>{t('identity.saveImage')}</button></section>
    <Sheet open={confirmCancel} title={t('booking.cancelConfirmTitle')} closeLabel={t('booking.keepAppointment')} onClose={() => setConfirmCancel(false)}>
      <p>{t('booking.cancelConfirmBody')}</p>
      <div className="mova-actions"><Button variant="secondary" type="button" onClick={() => setConfirmCancel(false)}>{t('booking.keepAppointment')}</Button><Button variant="destructive" loading={busy} type="button" onClick={() => void cancel()}>{t('booking.confirmCancel')}</Button></div>
    </Sheet>
  </main>;
}

export default BookingManageRoute;
