import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ScreenHeader } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import './scheduling.css';

// Icon paths copied from board 08b (inline SVG, no icon font).
const ICON_PATHS = {
  appointment: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4M12 13v5M9.5 15.5h5',
  client: 'M10 8.5a3.5 3.5 0 1 0 0-.01M3.5 20c.8-3.6 3.2-5.5 6.5-5.5 1.6 0 3 .4 4 1.2M18 14v6M15 17h6',
  block: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM6 6l12 12',
} as const;

// Board 08b: the Calendar "+" choice sheet. Three ways to add something to the calendar, plus Cancel.
export function CalendarAddPage() {
  const { t } = useTranslation();
  const { businessId } = useArtistBusiness();
  const back = operatorUrl(businessId, 'calendar');
  const rows = [
    { to: operatorUrl(businessId, 'calendar/new-appointment'), label: t('scheduling.add.appointment'), hint: t('scheduling.add.appointmentHint'), icon: 'appointment' as const },
    { to: operatorUrl(businessId, 'clients/new'), label: t('scheduling.add.client'), hint: t('scheduling.add.clientHint'), icon: 'client' as const },
    { to: operatorUrl(businessId, 'calendar/block-time'), label: t('scheduling.add.block'), hint: t('scheduling.add.blockHint'), icon: 'block' as const },
  ];
  return <main className="mova-page mova-scheduling mova-scheduling--sheet">
    <ScreenHeader title={t('scheduling.add.title')} trailing={<Link className="mova-scheduling__close" to={back} aria-label={t('scheduling.add.close')}>{t('scheduling.add.close')}</Link>} />
    <h1>{t('scheduling.add.title')}</h1>
    <nav className="mova-scheduling__choices" aria-label={t('scheduling.add.title')}>
      {rows.map((row) => <Link key={row.to} to={row.to} className="mova-scheduling__choice">
        <span className="mova-scheduling__choice-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATHS[row.icon]} /></svg></span>
        <span className="mova-scheduling__choice-copy"><strong>{row.label}</strong><small>{row.hint}</small></span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </Link>)}
    </nav>
    <Link className="mova-scheduling__cancel" to={back}>{t('scheduling.add.cancel')}</Link>
  </main>;
}

export default CalendarAddPage;
