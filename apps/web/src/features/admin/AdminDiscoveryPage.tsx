import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc } from './admin-api';
import { formatChange, formatCount, formatPercent } from './admin-format';
import { Card, ErrorNote, Kpi, Loading, PageHead } from './AdminPrimitives';
import type { Discovery, DiscoveryRow, GeographyRow, TrafficTotals } from './discovery-data';

import { AdminReportPeriodPicker, reportPeriodLabel, useAdminReportPeriod, type ReportPeriod } from './AdminReportPeriod';

const rangeDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
});

function useDiscovery(period: ReportPeriod) {
  return useQuery({
    queryKey: ['admin', 'website-traffic', period],
    queryFn: () => adminRpc<Discovery>('mova_admin_website_traffic', period),
  });
}

function DiscoveryKpis({ current, prior, details = false }: { current: TrafficTotals; prior: TrafficTotals; details?: boolean }) {
  const hasVisitors = current.identified_sessions > 0;
  const change = (value: number, previous: number) => formatChange(value, previous).text;
  return <div className="k4">
    <Kpi label="Visitors" value={hasVisitors || !current.sessions ? formatCount(current.visitors) : '—'}
      note={hasVisitors && prior.identified_sessions ? change(current.visitors, prior.visitors) : undefined} />
    <Kpi label="Sessions" value={formatCount(current.sessions)} note={change(current.sessions, prior.sessions)} />
    <Kpi label="Page views" value={formatCount(current.page_views)} note={change(current.page_views, prior.page_views)} />
    <Kpi label="Signup conversion" value={formatPercent(current.converted, current.sessions, 1)} note={`${formatCount(current.signups)} verified stylist signups`} />
    {details && <>
      <Kpi label="New visitors" value={hasVisitors || !current.sessions ? formatCount(current.new_users) : '—'} />
      <Kpi label="Returning visitors" value={hasVisitors || !current.sessions ? formatCount(current.returning_users) : '—'} />
      <Kpi label="Visits with a signup link click" value={formatCount(current.signup_clicks)} />
    </>}
  </div>;
}

function DataTable({ columns, rows, empty }: { columns: string[]; rows: { key: string; cells: ReactNode[] }[]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return <div className="tbl-wrap flat analytics-table"><table className="tbl">
    <thead><tr className="th">{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr className="tr" key={row.key}>{row.cells.map((value, index) =>
      index === 0 ? <th scope="row" key={columns[index]}>{value}</th> : <td key={columns[index]}>{value}</td>
    )}</tr>)}</tbody>
  </table></div>;
}

const locationNames = new Intl.DisplayNames(['en-US'], { type: 'region' });

function geographyLabel({ city, region, country }: GeographyRow): string {
  const name = country === 'US' ? 'USA' : /^[A-Z]{2}$/.test(country) ? locationNames.of(country) ?? country : country;
  return [city, region, name].filter(Boolean).join(', ') || 'Unknown';
}

function TrafficTable({ rows, kind, label, limit = 50, compact = false }: {
  rows: DiscoveryRow[]; kind: DiscoveryRow['kind']; label: string; limit?: number; compact?: boolean;
}) {
  return <DataTable
    columns={[label, 'Sessions', ...(!compact ? ['Visitors'] : []), 'Verified signups', 'Signup rate']}
    rows={rows.filter(row => row.kind === kind).slice(0, limit).map(row => ({
      key: row.label,
      cells: [row.label, formatCount(row.sessions), ...(!compact ? [row.visitors ? formatCount(row.visitors) : '—'] : []),
        formatCount(row.signups), formatPercent(row.converted, row.sessions, 1)],
    }))}
    empty="No traffic recorded in this view."
  />;
}

const breakdowns: { kind: DiscoveryRow['kind']; title: string; column: string }[] = [
  { kind: 'landing', title: 'Landing page conversion', column: 'Landing page' },
  { kind: 'campaign', title: 'UTM campaign tracking', column: 'Campaign / content' },
  { kind: 'channel', title: 'Traffic channels', column: 'Channel' },
  { kind: 'source', title: 'Traffic sources', column: 'Source' },
  { kind: 'referrer', title: 'Referrers', column: 'Referrer domain' },
  { kind: 'device', title: 'Devices', column: 'Device type' },
  { kind: 'browser', title: 'Browsers', column: 'Browser' },
];

export function AdminDiscoveryOverview({ period, search }: Pick<ReturnType<typeof useAdminReportPeriod>, 'period' | 'search'>) {
  const traffic = useDiscovery(period);
  return <Card title="Discovery" aside={<Link className="link-sm" to={{ pathname: '/admin/discovery', search }}>View discovery report</Link>}>
    <p className="small muted">{reportPeriodLabel(period)}, compared with the preceding period.</p>
    {traffic.isPending && <Loading />}
    {traffic.isError && <div className="row"><ErrorNote message={adminErrorText(traffic.error)} /><button type="button" className="btn sm" onClick={() => void traffic.refetch()}>Retry traffic</button></div>}
    {traffic.data && <>
      <DiscoveryKpis current={traffic.data.current} prior={traffic.data.prior} />
      <div className="cols2">
        <section className="stack"><h3 className="h2">Top landing pages</h3><TrafficTable rows={traffic.data.breakdown} kind="landing" label="Landing page" limit={3} compact /></section>
        <section className="stack"><h3 className="h2">Top traffic sources</h3><TrafficTable rows={traffic.data.breakdown} kind="source" label="Source" limit={3} compact /></section>
      </div>
    </>}
  </Card>;
}

export default function AdminDiscoveryPage() {
  const report = useAdminReportPeriod();
  const traffic = useDiscovery(report.period);
  const data = traffic.data;

  return <>
    <PageHead title="Discovery" sub={`Website traffic and verified stylist signups · ${reportPeriodLabel(report.period)}`}
      actions={<Link className="btn sm" to={{ pathname: '/admin', search: report.search }}>Overview</Link>} />
    <AdminReportPeriodPicker {...report} />
    {traffic.isPending && <Loading />}
    {traffic.isError && <div className="row"><ErrorNote message={adminErrorText(traffic.error)} /><button type="button" className="btn sm" onClick={() => void traffic.refetch()}>Retry traffic</button></div>}
    {data && <>
      <DiscoveryKpis current={data.current} prior={data.prior} details />
      <p className="small muted">{rangeDate.format(new Date(data.start))} to {rangeDate.format(new Date(data.through))} UTC. Signup rates are based on sessions that started in this range. Visitors are counted per browser. A session in a tab ends after 30 minutes of inactivity. Returning visitors were first seen before the selected period.
        {data.current.identified_sessions < data.current.sessions ? ` Visitor history is available for ${formatCount(data.current.identified_sessions)} of ${formatCount(data.current.sessions)} sessions.` : ''}
      </p>
      {breakdowns.map(section => <Card key={section.kind} title={section.title}>
        <TrafficTable rows={data.breakdown} kind={section.kind} label={section.column} />
      </Card>)}
      <Card title="Geography">
        <p className="small muted">Approximate location of each visit. Earlier sessions may have incomplete geography.</p>
        <DataTable columns={['Location', 'Sessions', 'Visitors', 'Verified signups', 'Signup rate']}
          rows={(data.geography ?? data.breakdown.filter(row => row.kind === 'country').map(row => ({
            ...row, city: '', region: '', country: row.label === 'Unknown' ? '' : row.label,
          }))).map(row => ({
            key: JSON.stringify([row.city, row.region, row.country]),
            cells: [geographyLabel(row), formatCount(row.sessions), row.visitors ? formatCount(row.visitors) : '—',
              formatCount(row.signups), formatPercent(row.converted, row.sessions, 1)],
          }))}
          empty="No locations recorded in this period." />
      </Card>
      <Card title="Website page traffic">
        <DataTable columns={['Page', 'Page views', 'Sessions with a view']} rows={data.pages.map(row => ({
          key: row.path, cells: [row.path, formatCount(row.views), formatCount(row.sessions)],
        }))} empty="No page views recorded in this period." />
      </Card>
      <Card title="Calculator acquisition">
        {data.calculator.partial_history && <p className="small muted">Some older calculator activity was recorded by UTC day. This range excludes those counts when it cuts through a day.</p>}
        <div className="k3">
          <Kpi label="Calculator uses" value={formatCount(data.calculator.used)} />
          <Kpi label="Start free clicks" value={formatCount(data.calculator.signup_clicks)} />
          <Kpi label="Verified signups" value={formatCount(data.calculator.signups)} />
        </div>
      </Card>
    </>}
  </>;
}
