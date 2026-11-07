import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, Sheet, TextField, Toggle } from '../../components';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { clientProfilesEnabled, publicEnv } from '../../lib/env';
import { QrCode } from './QrCode';

type Stylist = { business_id: string; name: string; handle: string; consents: { appointment_updates: boolean; reminders: boolean; offers: boolean } };
type ClientData = { profile: { display_name: string; preferred_locale: 'en-US' | 'es-US'; email?: string | null; phone?: string | null; verified_contacts?: Array<{ type: 'email' | 'phone'; value: string }> }; stylists: Stylist[]; upcoming: Array<{ id: string; service: string; starts_at: string; status: string; artist: string; handle: string; location: string }> };
type ClaimOption = { appointment_id: string; artist_business_id: string; artist: string; handle: string; service: string; starts_at: string; status: string; location: string };
const endpoint = (name: string) => `${publicEnv.VITE_SUPABASE_URL}/functions/v1/${name}`;

export function ClientProfilePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<ClientData | null>(null);
  const [claimOptions, setClaimOptions] = useState<ClaimOption[]>([]);
  const [cardUrl, setCardUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'confirm' | 'code'>('confirm');
  const [deleteCode, setDeleteCode] = useState('');
  const [name, setName] = useState('');

  const request = useCallback(async (functionName: string, body: Record<string, unknown>) => {
    const client = createMovaSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) { navigate('/signin?returnTo=%2Fme', { replace: true }); return null; }
    const response = await fetch(endpoint(functionName), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.code ?? 'CLIENT_PROFILE_FAILED');
    return result.data;
  }, [navigate]);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const result = await request('customer-profile', { action: 'profile' }) as ClientData | null;
      if (!result) return;
      setData(result); setName(result.profile.display_name);
      try {
        const claims = await request('customer-profile', { action: 'claim-options' }) as { options?: ClaimOption[] } | null;
        setClaimOptions(claims?.options ?? []);
      } catch { setClaimOptions([]); }
      const stylist = result.stylists.find((item) => item.handle === result.upcoming[0]?.handle) ?? result.stylists[0];
      if (stylist) {
        try {
          const card = await request('client-card-token', { artist_business_id: stylist.business_id }) as { url?: string } | null;
          setCardUrl(card?.url ?? '');
        } catch { setCardUrl(''); }
      } else setCardUrl('');
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { if (clientProfilesEnabled) void load(); else setLoading(false); }, [load]);

  const signOut = async () => {
    const client = createMovaSupabaseClient(); setBusy(true);
    const { error: signOutError } = await client.auth.signOut(); setBusy(false);
    if (signOutError) setError(true); else navigate('/', { replace: true });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await request('customer-profile', { action: 'update-profile', display_name: name, preferred_locale: i18n.resolvedLanguage === 'es-US' ? 'es-US' : 'en-US' }); setEditing(false); await load(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  const consent = async (stylist: Stylist, purpose: 'appointment_updates' | 'rebooking_reminders' | 'offers', granted: boolean) => {
    setBusy(true);
    try { await request('customer-profile', { action: 'consent', business_id: stylist.business_id, purpose, channel: 'sms', granted }); await load(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  const beginDelete = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const client = createMovaSupabaseClient();
      const rawPhone = data.profile.verified_contacts?.find((contact) => contact.type === 'phone')?.value;
      const phone = rawPhone ? `+${rawPhone.replace(/\D/g, '')}` : undefined;
      const email = data.profile.verified_contacts?.find((contact) => contact.type === 'email')?.value;
      const result = phone ? await client.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } })
        : email ? await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }) : null;
      if (!result) throw new Error('VERIFIED_CONTACT_REQUIRED');
      if (result.error) throw result.error;
      setDeleteStep('code');
    } catch { setError(true); } finally { setBusy(false); }
  };
  const confirmDelete = async () => {
    if (!data || deleteCode.length !== 6) return;
    setBusy(true);
    try {
      const client = createMovaSupabaseClient();
      const rawPhone = data.profile.verified_contacts?.find((contact) => contact.type === 'phone')?.value;
      const phone = rawPhone ? `+${rawPhone.replace(/\D/g, '')}` : undefined;
      const email = data.profile.verified_contacts?.find((contact) => contact.type === 'email')?.value;
      const result = phone ? await client.auth.verifyOtp({ phone, token: deleteCode, type: 'sms' })
        : email ? await client.auth.verifyOtp({ email, token: deleteCode, type: 'email' }) : null;
      if (!result) throw new Error('VERIFIED_CONTACT_REQUIRED');
      if (result.error) throw result.error;
      await request('customer-profile', { action: 'delete-profile' });
      await createMovaSupabaseClient().auth.signOut();
      navigate('/', { replace: true });
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  const claimBooking = async (appointmentId: string) => {
    setBusy(true);
    try { await request('customer-profile', { action: 'claim-booking', appointment_id: appointmentId }); await load(); }
    catch { setError(true); } finally { setBusy(false); }
  };
  const saveCardImage = async () => {
    const qr = document.querySelector<HTMLImageElement>('.mova-client-profile__qr .mova-generated-qr img');
    if (!qr || !data || !cardUrl) return;
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 700;
      const context = canvas.getContext('2d'); if (!context) throw new Error('CANVAS_UNAVAILABLE');
      const style = getComputedStyle(document.documentElement);
      context.fillStyle = style.getPropertyValue('--forest').trim(); context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = style.getPropertyValue('--surface-page').trim(); context.font = '800 52px Manrope'; context.fillText('mova.', 64, 80);
      context.font = '700 22px "DM Sans"'; context.fillStyle = style.getPropertyValue('--mint').trim(); context.fillText(t('identity.clientCard'), 64, 155);
      context.fillStyle = style.getPropertyValue('--surface-page').trim(); context.font = '800 54px Manrope'; context.fillText(data.profile.display_name || t('identity.client'), 64, 245);
      context.fillStyle = style.getPropertyValue('--mint').trim(); context.font = '500 28px "DM Sans"'; context.fillText(t('identity.withStylist', { name: selectedStylist?.name ?? t('identity.client') }), 64, 305);
      if (next) context.fillText(t('identity.nextAppointment', { date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(next.starts_at)) }), 64, 365);
      context.drawImage(qr, 885, 190, 250, 250);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('IMAGE_EXPORT_FAILED')), 'image/png'));
      const file = new File([blob], 'mova-client-card.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: t('identity.clientCard') });
      else { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = file.name; link.click(); URL.revokeObjectURL(link.href); }
    } catch { setError(true); }
  };
  const exportData = async () => {
    setBusy(true);
    try {
      const payload = await request('customer-profile', { action: 'export' });
      if (!payload) throw new Error('EXPORT_UNAVAILABLE');
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'mova-client-data.json'; anchor.click(); URL.revokeObjectURL(url);
    } catch { setError(true); } finally { setBusy(false); }
  };

  if (!clientProfilesEnabled) return <main className="mova-page mova-client-profile"><p className="mova-wordmark">mova.</p><h1>{t('identity.profileTitle')}</h1><p>{t('identity.disabled')}</p><Link to="/">{t('identity.continueGuest')}</Link></main>;
  if (loading) return <main className="mova-page mova-client-profile" aria-busy="true"><p role="status">{t('identity.loading')}</p></main>;
  if (error || !data) return <main className="mova-page mova-client-profile"><ErrorState title={t('identity.profileLoadError')} retryLabel={t('identity.retry')} onRetry={() => void load()}/></main>;

  const next = data.upcoming[0];
  const selectedStylist = data.stylists.find((item) => item.handle === next?.handle) ?? data.stylists[0];
  const nextDate = next ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(next.starts_at)) : null;
  return <main className="mova-page mova-client-profile">
    <header className="mova-client-profile__brand"><span className="mova-wordmark">mova.</span></header>
    <h1>{t('identity.profileTitle')}</h1>
    {selectedStylist && <Card tone="inverse" className="mova-client-profile__card">
      <div className="mova-client-profile__card-copy"><small>{t('identity.clientCard')}</small><strong>{data.profile.display_name || t('identity.client')}</strong><span>{t('identity.withStylist', { name: selectedStylist.name })}</span><span>{nextDate ? t('identity.nextAppointment', { date: nextDate }) : t('identity.noUpcoming')}</span></div>
      <div className="mova-client-profile__card-qr" aria-label={t('identity.clientCardQr')}>
        {cardUrl ? <><QrCode value={cardUrl} label={t('identity.clientCardQr')} size={160} className="mova-client-profile__qr"/><small>{t('identity.rebookCheckIn')}</small></> : <span>{t('identity.clientCardUnavailable')}</span>}
      </div>
      <div className="mova-client-profile__card-actions"><Button type="button" variant="secondary" disabled={!cardUrl} onClick={() => void saveCardImage()}>{t('identity.saveImage')}</Button></div>
    </Card>}
    {next && <section className="mova-client-profile__section"><h2>{t('identity.upcoming')}</h2><Card className="mova-client-profile__row"><strong>{next.service} · {next.artist}</strong><span>{nextDate} · {next.location}</span><span className="mova-client-profile__status">{t(`booking.status.${next.status}`, { defaultValue: next.status })}</span></Card></section>}
    {claimOptions.length > 0 && <section className="mova-client-profile__section"><h2>{t('identity.claimPastBookings')}</h2>{claimOptions.map((claim) => <Card className="mova-client-profile__claim" key={claim.appointment_id}><strong>{claim.service} · {claim.artist}</strong><span>{new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(claim.starts_at))} · {claim.location}</span><Button type="button" variant="secondary" disabled={busy} loading={busy} onClick={() => void claimBooking(claim.appointment_id)}>{t('identity.claimBooking')}</Button></Card>)}</section>}
    <section className="mova-client-profile__section"><h2>{t('identity.myStylists')}</h2>{data.stylists.length ? data.stylists.map((stylist) => <Card className="mova-client-profile__stylist" key={stylist.business_id}><span className="mova-client-profile__initials" aria-hidden="true">{stylist.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><div><strong>{stylist.name}</strong><Link to={`/a/${encodeURIComponent(stylist.handle)}/book`}>{t('identity.bookAgain')}</Link></div></Card>) : <EmptyState title={t('identity.noStylists')}/>}</section>
    {data.stylists.map((stylist) => <Card className="mova-client-profile__consents" key={`consent-${stylist.business_id}`}><Toggle label={t('identity.appointmentTexts')} checked={stylist.consents.appointment_updates} disabled={busy} onChange={(value) => void consent(stylist, 'appointment_updates', value)}/><Toggle label={t('identity.remindersAndOffers', { name: stylist.name.split(' ')[0] })} checked={stylist.consents.reminders && stylist.consents.offers} disabled={busy} onChange={async (value) => { await consent(stylist, 'rebooking_reminders', value); await consent(stylist, 'offers', value); }}/></Card>)}
    {editing && <form className="mova-client-profile__edit" onSubmit={(event) => void save(event)}><label className="mova-field"><span>{t('identity.name')}</span><input className="mova-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required/></label><Button type="submit" loading={busy}>{t('identity.save')}</Button></form>}
    <footer className="mova-client-profile__footer"><button type="button" onClick={() => setEditing((value) => !value)}>{editing ? t('identity.cancel') : t('identity.editDetails')}</button><span> · </span><button type="button" disabled={busy} onClick={() => void exportData()}>{t('privacy.exportMyData')}</button><span> · </span><button type="button" disabled={busy} onClick={() => void signOut()}>{t('settings.signOut')}</button><span> · </span><button type="button" disabled={busy} onClick={() => { setDeleteStep('confirm'); setDeleteCode(''); setDeleteOpen(true); }}>{t('identity.deleteProfile')}</button></footer>
    {error && <p role="alert">{t('identity.profileSaveError')}</p>}
    <Sheet open={deleteOpen} title={t('identity.deleteConfirmTitle')} closeLabel={t('identity.cancel')} onClose={() => setDeleteOpen(false)}>
      <div className="mova-client-profile__delete-confirm"><p>{t('identity.deleteConfirmBody')}</p>{deleteStep==='confirm'?<Button type="button" loading={busy} onClick={() => void beginDelete()}>{t('identity.sendDeleteCode')}</Button>:<><p>{t('identity.deleteCodeSent')}</p><TextField label={t('identity.code')} inputMode="numeric" autoComplete="one-time-code" value={deleteCode} onChange={(event) => setDeleteCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" required/><Button type="button" variant="destructive" loading={busy} disabled={deleteCode.length!==6} onClick={() => void confirmDelete()}>{t('identity.deleteProfile')}</Button><button className="mova-link-button" type="button" disabled={busy} onClick={() => { setDeleteCode(''); void beginDelete(); }}>{t('identity.resendDeleteCode')}</button></>}<Button type="button" variant="secondary" disabled={busy} onClick={() => setDeleteOpen(false)}>{t('identity.cancel')}</Button></div>
    </Sheet>
  </main>;
}

export default ClientProfilePage;
