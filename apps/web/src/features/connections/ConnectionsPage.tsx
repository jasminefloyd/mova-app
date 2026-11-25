import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ScreenHeader } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';
import { usePlan } from '../billing/PlanProvider';
import { isLocked } from '../billing/plan-api';
import {
  appleCalendarPill, CONNECTION_PATHS, googleCalendarPill, googlePill, loadConnectionStatuses, metaPill, stripePill,
  type ConnectionKey, type ConnectionPill, type ConnectionStatuses,
} from './connections-api';
import { ConnectionRow } from './ConnectionsUi';

// CN2: one place to connect Stripe, Google, Meta and calendars. Each row shows only the logo, the name and
// the status; everything else is on the connection's own page.

const SECTIONS: Array<{ key: string; items: ConnectionKey[] }> = [
  { key: 'payments', items: ['stripe'] },
  { key: 'reputation', items: ['google', 'meta'] },
  { key: 'calendars', items: ['googleCalendar', 'appleCalendar'] },
];

export function useConnectionStatuses() {
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [statuses, setStatuses] = useState<ConnectionStatuses | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!client || !businessId) return;
    setLoading(true);
    setStatuses(await loadConnectionStatuses(client, businessId));
    setLoading(false);
  }, [client, businessId]);
  useEffect(() => { if (!identityLoading) void reload(); }, [identityLoading, reload]);
  return { statuses, loading: identityLoading || loading, reload };
}

export function useConnectionPills(statuses: ConnectionStatuses | null): Record<ConnectionKey, ConnectionPill> {
  const { summary } = usePlan();
  const calendarLocked = isLocked(summary, 'google_calendar_sync');
  return {
    stripe: stripePill(statuses?.stripe ?? null),
    google: googlePill(statuses?.google ?? null),
    meta: metaPill(statuses?.meta ?? null),
    googleCalendar: calendarLocked ? { tone: 'off', labelKey: 'planGate.badgePro' } : googleCalendarPill(statuses?.google ?? null),
    appleCalendar: appleCalendarPill(statuses?.google ?? null),
  };
}

/** The list of connections, used by the hub and (on wide screens) beside each connection's page. */
export function ConnectionsList({ statuses, current }: { statuses: ConnectionStatuses | null; current?: ConnectionKey }) {
  const { t } = useTranslation();
  const { businessId } = useArtistBusiness();
  const pills = useConnectionPills(statuses);
  return <>{SECTIONS.map((section) => <div key={section.key} className="mova-conn-group">
    <h2 className="mova-conn-section">{t(`connections.sections.${section.key}`)}</h2>
    <div className="mova-conn-list">
      {section.items.map((key) => <ConnectionRowLink key={key} name={key} title={t(`connections.names.${key}`)} pill={pills[key]} to={operatorUrl(businessId, CONNECTION_PATHS[key])} current={current === key} />)}
    </div>
  </div>)}</>;
}

function ConnectionRowLink({ current, ...props }: { name: ConnectionKey; title: string; pill: ConnectionPill; to: string; current: boolean }) {
  return current ? <div aria-current="page" className="mova-conn-current"><ConnectionRow {...props} /></div> : <ConnectionRow {...props} />;
}

export function ConnectionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { businessId } = useArtistBusiness();
  const { statuses, loading, reload } = useConnectionStatuses();
  const failed = !loading && statuses && !statuses.stripe && !statuses.google && !statuses.meta;
  return <main className="mova-page mova-conn-page">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings'))} backLabel={t('connections.backSettings')} />
    <div className="mova-conn-head">
      <h1>{t('connections.title')}</h1>
      <p className="mova-conn-lead">{t('connections.intro')}</p>
    </div>
    {loading && !statuses ? <p role="status" aria-busy="true">{t('connections.loading')}</p> : <>
      {failed && <div className="mova-conn-message is-error" role="alert"><p>{t('connections.loadError')}</p><Button variant="secondary" onClick={() => void reload()}>{t('connections.retry')}</Button></div>}
      <ConnectionsList statuses={statuses} />
      <p className="mova-conn-foot">{t('connections.footnote')}</p>
    </>}
  </main>;
}

/**
 * Wraps a connection's page. On phones it is just the page; from 1024px the hub stays on the left (CN8).
 */
export function ConnectionShell({ current, children }: { current: ConnectionKey; children: ReactNode }) {
  const { t } = useTranslation();
  const { businessId } = useArtistBusiness();
  const { statuses } = useConnectionStatuses();
  return <main className="mova-page mova-conn-page mova-conn-page--wide">
    <nav className="mova-conn-crumbs" aria-label={t('connections.breadcrumb')}>
      <Link to={operatorUrl(businessId, 'settings')}>{t('navigation.settings')}</Link><span aria-hidden="true">/</span>
      <Link to={operatorUrl(businessId, 'settings/connections')}>{t('connections.title')}</Link>
    </nav>
    <div className="mova-conn-split">
      <aside className="mova-conn-split__hub" aria-label={t('connections.title')}>
        <h2 className="mova-conn-split__title">{t('connections.title')}</h2>
        <p className="mova-conn-lead">{t('connections.introShort')}</p>
        <ConnectionsList statuses={statuses} current={current} />
      </aside>
      <div className="mova-conn-split__detail">{children}</div>
    </div>
  </main>;
}

export default ConnectionsPage;
