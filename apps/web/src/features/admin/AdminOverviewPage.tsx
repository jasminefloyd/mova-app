import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type Overview, type OverviewWindow } from './admin-api';
import { downloadText, formatChange, formatCount, formatMoneyMinor, formatPercent, isoWeekLabel, toCsv } from './admin-format';
import { Card, ErrorNote, Kpi, Loading, PageHead, Segmented } from './AdminPrimitives';

type WindowKey = '7' | '30' | '90';

const kpis: { key: keyof OverviewWindow; label: string; money?: boolean }[] = [
  { key: 'active_stylists', label: 'Active stylists' },
  { key: 'new_signups', label: 'New sign-ups' },
  { key: 'bookings_made', label: 'Bookings made' },
  { key: 'completed', label: 'Appointments completed' },
  { key: 'processed_minor', label: 'Processed', money: true },
  { key: 'fees_minor', label: 'Mova fees', money: true },
];

const nudgeReason: Record<Overview['needs_nudge']['items'][number]['reason'], string> = {
  quiet: 'No bookings in two weeks',
  stripe_restricted: 'Payouts restricted',
  published_no_bookings: 'Published page, no bookings yet',
};

export default function AdminOverviewPage() {
  const [days, setDays] = useState<WindowKey>('30');
  const overview = useQuery({
    queryKey: ['admin', 'overview', days],
    queryFn: () => adminRpc<Overview>('mova_admin_overview', { p_days: Number(days) }),
  });

  function exportCsv() {
    const data = overview.data;
    if (!data) return;
    const rows = kpis.map((kpi) => [kpi.label, data.current[kpi.key], data.prior[kpi.key]]);
    downloadText(`mova-overview-${days}d.csv`, toCsv(['Metric', `Last ${days} days`, 'Prior period'], rows));
  }

  return (
    <>
      <PageHead
        title="Overview"
        sub="Platform numbers for the period. Amounts are in US dollars; days are Eastern time."
        actions={<><Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} /><button type="button" className="btn sm ghost" onClick={exportCsv} disabled={!overview.data}>Export CSV</button></>}
      />
      <ErrorNote message={overview.isError ? adminErrorText(overview.error) : null} />
      {overview.isPending ? <Loading /> : null}
      {overview.data ? (
        <>
          <div className="kpi-grid">
            {kpis.map((kpi) => {
              const current = overview.data.current[kpi.key];
              const change = formatChange(current, overview.data.prior[kpi.key]);
              const value = kpi.money ? formatMoneyMinor(current) : formatCount(current);
              return <Kpi key={kpi.key} label={kpi.label} value={value} note={<span className={`${change.direction === 'up' ? 'up' : change.direction === 'down' ? 'down' : ''}`}>{change.text}</span>} />;
            })}
          </div>
          <div className="cols2">
            <Card title="Seat filler and autopilot">
              <dl className="kv">
                <dt>Seat filler filled</dt><dd>{formatCount(overview.data.current.seat_filler_filled)} of {formatCount(overview.data.current.seat_filler_offered)} offers</dd>
                <dt>Autopilot rebooked</dt><dd>{formatCount(overview.data.current.autopilot_rebooked)} of {formatCount(overview.data.current.autopilot_sent)} messages</dd>
                <dt>Concierge handed to a stylist</dt><dd>{formatCount(overview.data.current.concierge_handed)} of {formatCount(overview.data.current.concierge_conversations)} conversations ({formatPercent(overview.data.current.concierge_handed, overview.data.current.concierge_conversations)})</dd>
                <dt>No-shows</dt><dd>{formatCount(overview.data.current.no_shows)}</dd>
              </dl>
            </Card>
            <Card title="Funnel">
              <ul className="list">
                {([
                  ['Waitlist', overview.data.funnel.waitlist],
                  ['Invited', overview.data.funnel.invited],
                  ['Signed up', overview.data.funnel.signed_up],
                  ['Published a page', overview.data.funnel.published_page],
                  ['Payouts connected', overview.data.funnel.stripe_connected],
                  ['First booking', overview.data.funnel.first_booking],
                ] as const).map(([label, count]) => (
                  <li key={label} className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{label}</span><span className="mono">{formatCount(count)} <span className="muted small">{formatPercent(count, overview.data.funnel.waitlist)}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="cols2">
            <Card title="Weekly active stylists">
              {overview.data.weekly_active.length === 0 ? <p className="muted">No activity in this period.</p> : (
                <table className="tbl"><thead><tr className="th"><th>Week</th><th>Active stylists</th></tr></thead><tbody>
                  {overview.data.weekly_active.map((row) => (
                    <tr key={row.week} className="tr"><td>{isoWeekLabel(row.week)} · {row.week}</td><td className="mono">{formatCount(row.stylists)}</td></tr>
                  ))}
                </tbody></table>
              )}
            </Card>
            <Card title="Top stylists">
              {overview.data.top_stylists.length === 0 ? <p className="muted">No completed appointments yet.</p> : (
                <table className="tbl"><thead><tr className="th"><th>Stylist</th><th>Completed</th><th>Processed</th></tr></thead><tbody>
                  {overview.data.top_stylists.map((row) => (
                    <tr key={row.business_id} className="tr">
                      <td><Link to={`/admin/stylists/${row.business_id}`}>{row.name}</Link> <span className="muted small">B{row.bid}</span></td>
                      <td className="mono">{formatCount(row.completed)}</td><td className="mono">{formatMoneyMinor(row.processed_minor)}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </Card>
          </div>
          <div className="cols2">
            <Card title={`Needs a nudge (${formatCount(overview.data.needs_nudge.quiet)} quiet)`}>
              {overview.data.needs_nudge.items.length === 0 ? <p className="muted">Nobody needs a nudge right now.</p> : (
                <ul className="list">
                  {overview.data.needs_nudge.items.map((item) => (
                    <li key={`${item.business_id}-${item.reason}`} className="row" style={{ justifyContent: 'space-between' }}>
                      <Link to={`/admin/stylists/${item.business_id}`}>{item.name}</Link><span className="small muted">{nudgeReason[item.reason]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Language">
              <dl className="kv">
                <dt>English (US)</dt><dd>{formatCount(overview.data.language.en_us)}</dd>
                <dt>Spanish (US)</dt><dd>{formatCount(overview.data.language.es_us)}</dd>
              </dl>
              <p className="small muted">Admin screens are English only.</p>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
