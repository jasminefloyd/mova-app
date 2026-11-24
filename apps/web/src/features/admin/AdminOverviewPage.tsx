import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type Overview, type OverviewWindow } from './admin-api';
import { downloadText, formatChange, formatCount, formatMoneyWhole, formatPercent, isoWeekLabel, toCsv } from './admin-format';
import { Card, ErrorNote, Kpi, Loading, PageHead } from './AdminPrimitives';

import { AdminDiscoveryOverview } from './AdminDiscoveryPage';
import { AdminActivation, AdminSubscriptionMetrics } from './AdminGrowthMetrics';

import { AdminReportPeriodPicker, reportPeriodLabel, useAdminReportPeriod } from './AdminReportPeriod';

const kpis: { key: keyof OverviewWindow; label: string; money?: boolean; percentage?: boolean; note?: string }[] = [
  { key: 'active_stylists', label: 'Active stylists' },
  { key: 'new_signups', label: 'New stylist businesses' },
  { key: 'bookings_made', label: 'Bookings made' },
  { key: 'no_shows', label: 'No-show rate', percentage: true },
  { key: 'processed_minor', label: 'Processed by Mova', money: true },
  { key: 'fees_minor', label: 'Mova fees earned', money: true },
  { key: 'recorded_minor', label: 'Recorded by stylists', money: true, note: 'Cash, Zelle, other · no fee' },
  { key: 'salon_minor', label: 'Collected by salons', money: true, note: 'No fee' },
];

const nudgeReason: Record<Overview['needs_nudge']['items'][number]['reason'], string> = {
  quiet: 'No bookings in 14+ days',
  stripe_restricted: 'Stripe restricted · payouts paused',
  published_no_bookings: 'Published, no bookings yet',
};

export default function AdminOverviewPage() {
  const report = useAdminReportPeriod();
  const { period } = report;
  const periodLabel = reportPeriodLabel(period);
  const overview = useQuery({
    queryKey: ['admin', 'overview', period],
    queryFn: () => adminRpc<Overview>('mova_admin_overview_for_period', period),
  });

  function exportCsv() {
    const data = overview.data;
    if (!data) return;
    const rows = kpis.map(kpi => kpi.percentage
      ? [kpi.label, formatPercent(data.current.no_shows, data.current.appointments_due, 1), formatPercent(data.prior.no_shows, data.prior.appointments_due, 1)]
      : [kpi.label, data.current[kpi.key], data.prior[kpi.key]]);
    const suffix = period.p_period === 'custom' ? `${period.p_start}-to-${period.p_end}` : period.p_period;
    downloadText(`mova-overview-${suffix}.csv`, toCsv(['Metric', periodLabel, 'Prior period'], rows));
  }

  return (
    <>
      <PageHead
        title="Overview"
        sub={`${periodLabel}, compared with the preceding period.`}
        actions={<button type="button" className="btn sm" onClick={exportCsv} disabled={!overview.data}>Export</button>}
      />
      <AdminReportPeriodPicker {...report} />
      <ErrorNote message={overview.isError ? adminErrorText(overview.error) : null} />
      {overview.isPending ? <Loading /> : null}
      {overview.data ? (() => {
        const o = overview.data;
        const perStylist = (w: OverviewWindow) => w.completed / Math.max(w.active_stylists, 1);
        const star = formatChange(perStylist(o.current), perStylist(o.prior));
        const weeks = o.weekly_active;
        const maxWeek = Math.max(1, ...weeks.map((entry) => entry.stylists));
        const languageTotal = Math.max(1, o.language.en_us + o.language.es_us);
        // North-star trend: weekly active stylists as a filled line (A2).
        const points = weeks.map((row, index) => [weeks.length > 1 ? index / (weeks.length - 1) * 400 : 200, 56 - row.stylists / maxWeek * 48] as const);
        const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
        return <>
          <section className="northstar" aria-label="North star metric">
            <div><div className="eyebrow">North star</div><div className="northstar__label">Completed appointments per active stylist</div>
              <div className="value">{formatCount(Math.round(perStylist(o.current) * 10) / 10)}</div>
              <div className="small"><span className={star.direction === 'down' ? 'down' : 'up'}>{star.text}</span> vs prior period · {formatCount(o.current.completed)} completed · {formatCount(o.current.active_stylists)} active</div>
            </div>
            {points.length > 1 ? <svg className="northstar__trend" viewBox="0 0 400 60" preserveAspectRatio="none" role="img" aria-label="Weekly active stylists trend"><path d={`${line} L400 60 L0 60 Z`} className="area" /><path d={line} className="stroke" /></svg> : <span />}
          </section>
          <div className="k4">
            {kpis.map((kpi) => {
              const current = o.current[kpi.key];
              const change = kpi.percentage
                ? formatChange(current / (o.current.appointments_due || 1), o.prior.no_shows / (o.prior.appointments_due || 1))
                : formatChange(current, o.prior[kpi.key]);
              const value = kpi.money ? formatMoneyWhole(current) : kpi.percentage ? formatPercent(current, o.current.appointments_due, 1) : formatCount(current);
              return <Kpi key={kpi.key} label={kpi.label} value={value} note={kpi.note ?? <span className={`${change.direction === 'up' ? 'up' : change.direction === 'down' ? 'down' : ''}`}>{change.text}</span>} />;
            })}
          </div>
            <Card title="Active stylists by week" aside={<span className="small muted">Stylists with a booking created that week</span>}>
              {weeks.length === 0 ? <p className="muted">No activity in this period.</p> : <div className="weekly-bars">{weeks.map((row, index) => (
                <div key={row.week} title={`${isoWeekLabel(row.week)} · ${formatCount(row.stylists)}`} className={index === weeks.length - 1 ? 'is-current' : ''}><b>{formatCount(row.stylists)}</b><i style={{ height: `${Math.max(8, row.stylists / maxWeek * 100)}%` }} /><small>{isoWeekLabel(row.week)}</small></div>
              ))}</div>}
            </Card>
          <div className="k3">
            <Kpi label="Seat filler" value={formatCount(o.current.seat_filler_filled)} note={`open slots refilled · ${formatPercent(o.current.seat_filler_filled, o.current.seat_filler_offered)} of slots offered`} />
            <Kpi label="Rebooking autopilot" value={formatPercent(o.current.autopilot_rebooked, o.current.autopilot_sent)} note={`rebooked from ${formatCount(o.current.autopilot_sent)} reminder texts`} />
            <Kpi label="AI Concierge" value={formatPercent(o.current.concierge_conversations - o.current.concierge_handed, o.current.concierge_conversations)} note={`handled · ${formatPercent(o.current.concierge_handed, o.current.concierge_conversations)} handed to the stylist`} />
          </div>
          <div className="detail-grid">
            <Card title="Top stylists by completed visits" aside={<Link className="link-sm" to="/admin/stylists">All stylists</Link>} className="pad0">
              {o.top_stylists.length === 0 ? <p className="muted" style={{ padding: 16 }}>No completed appointments yet.</p> : (
                <table className="tbl"><thead><tr className="th"><th>Stylist</th><th className="num">Completed</th><th className="num">Processed</th></tr></thead><tbody>
                  {o.top_stylists.map((row) => (
                    <tr key={row.business_id} className="tr">
                      <td><Link to={`/admin/stylists/${row.business_id}`}><strong>{row.business_name}</strong></Link><br /><span className="muted small">{row.name} · BID-{row.bid}</span></td>
                      <td className="num"><strong>{formatCount(row.completed)}</strong></td><td className="num">{formatMoneyWhole(row.processed_minor)}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </Card>
            <div className="stack">
              <Card title="Need a nudge" aside={<span className="pill p-warn">{formatCount(o.needs_nudge.quiet)} quiet</span>}>
                {o.needs_nudge.items.length === 0 ? <p className="muted">Nobody needs a nudge right now.</p> : (
                  <ul className="activity-list">
                    {o.needs_nudge.items.map((item) => (
                      <li key={`${item.business_id}-${item.reason}`}><span><Link to={`/admin/stylists/${item.business_id}`}><strong>{item.name}</strong></Link><br /><span className="small muted">{item.business_name} · BID-{item.bid}</span></span><span className="small nudge-reason">{nudgeReason[item.reason]}</span></li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Language">
                <span className="lang-bar" aria-hidden="true"><i style={{ width: `${o.language.en_us / languageTotal * 100}%` }} /></span>
                <p className="lang-legend small"><span><i className="dot en" />English {formatPercent(o.language.en_us, languageTotal)}</span><span><i className="dot es" />Spanish {formatPercent(o.language.es_us, languageTotal)}</span></p>
              </Card>
            </div>
          </div>
        </>;
      })() : null}
      <AdminDiscoveryOverview period={period} search={report.search} />
      <AdminActivation />
      <AdminSubscriptionMetrics period={period} />
    </>
  );
}
