import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, StatusChip } from '../../components';
import { publicEnv } from '../../lib/env';

type CardData = { client_name: string; artist_name: string; handle: string; specialties: string[] };
type Appointment = { service: string; starts_at: string; status: string; location: string };
const cardEndpoint = `${publicEnv.VITE_SUPABASE_URL}/functions/v1/client-card-landing`;

export function ClientCardLandingPage() {
  const { token = '' } = useParams();
  const { t, i18n } = useTranslation();
  const [card, setCard] = useState<CardData | null>(null);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(cardEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '' },
          body: JSON.stringify({ token }),
        });
        const result = await response.json();
        if (!response.ok || !result.data?.card) throw new Error('CARD_NOT_AVAILABLE');
        if (active) {
          setCard(result.data.card as CardData);
          setAppointment((result.data.upcoming as Appointment | null) ?? null);
        }
      } catch {
        if (active) setUnavailable(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  if (loading) return <main className="mova-page mova-client-card-landing" aria-busy="true"><p role="status">{t('identity.loading')}</p></main>;
  if (unavailable || !card) return <main className="mova-page mova-client-card-landing"><EmptyState title={t('identity.cardUnavailable')} detail={t('identity.cardUnavailableDetail')}/></main>;
  const date = appointment ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(appointment.starts_at)) : null;
  return <main className="mova-page mova-client-card-landing">
    <header className="mova-client-card-landing__brand"><span className="mova-wordmark">mova.</span></header>
    <Card tone="inverse" className="mova-client-card-landing__hero">
      <small>{t('identity.clientCard')}</small>
      <h1>{card.client_name || t('identity.client')}</h1>
      <p>{t('identity.withStylist', { name: card.artist_name })}</p>
      {card.specialties.length > 0 && <p>{card.specialties.join(' · ')}</p>}
    </Card>
    {appointment ? <section className="mova-client-card-landing__section">
      <h2>{t('identity.upcoming')}</h2>
      <Card className="mova-client-card-landing__appointment">
        <strong>{appointment.service}</strong>
        <span>{date} · {appointment.location}</span>
        <StatusChip status={appointment.status === 'confirmed' ? 'confirmed' : 'pending'}>{t(`booking.status.${appointment.status}`, { defaultValue: appointment.status })}</StatusChip>
      </Card>
    </section> : <EmptyState title={t('identity.noUpcoming')}/>}
    <Link className="mova-button mova-button--primary" to={`/a/${encodeURIComponent(card.handle)}/book`}>{t('identity.bookWith', { name: card.artist_name.split(' ')[0] })}</Link>
    <Link className="mova-client-card-landing__profile" to={`/a/${encodeURIComponent(card.handle)}`}>{t('identity.viewArtistProfile')}</Link>
  </main>;
}

export default ClientCardLandingPage;
