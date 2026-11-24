import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc } from './admin-api';
import { formatChange, formatCount, formatPercent } from './admin-format';
import { Card, ErrorNote, Kpi, Loading, PageHead } from './AdminPrimitives';
import type { Discovery, DiscoveryRow, VisitTotals } from './discovery-data';

function useDiscovery() {
  return useQuery({
    queryKey: ['admin', 'discovery'],
    queryFn: () => adminRpc<Discovery>('mova_admin_discovery'),
  });
}

function change(current: number | undefined, prior: number | undefined) {
  return current !== undefined && prior !== undefined ? `${formatChange(current, prior).text} vs prior 28 days` : undefined;
}

function DiscoveryKpis({ current, prior }: {
  current: VisitTotals | null | undefined; prior: VisitTotals | null | undefined;
}) {
  const currentRate = current?.visits ? current.converted / current.visits : undefined;
  const priorRate = prior?.visits ? prior.converted / prior.visits : undefined;
  const metric = (value: number | undefined) => value === undefined ? '—' : formatCount(value);
  return <div className="k4">
    <Kpi label="Website visits" value={metric(current?.visits)} note={change(current?.visits, prior?.visits)} />
    <Kpi label="Visits with a signup link click" value={metric(current?.signup_clicks)} note={change(current?.signup_clicks, prior?.signup_clicks)} />
    <Kpi label="Verified stylist signups" value={metric(current?.signups)} note={change(current?.signups, prior?.signups)} />
    <Kpi label="Visit to signup rate" value={current ? formatPercent(current.converted, current.visits, 1) : '—'} note={change(currentRate, priorRate)} />
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

function trafficLabel(row: DiscoveryRow) {
  if (row.kind === 'landing') return row.landing_path;
  if (row.kind === 'channel') return row.channel;
  return [row.source, row.medium, row.campaign, ...(row.content ? [row.content] : [])].map(value => value || '—').join(' / ');
}

function TrafficTable({ rows, kind, limit = 25, compact = false }: { rows: DiscoveryRow[]; kind: DiscoveryRow['kind']; limit?: number; compact?: boolean }) {
  return <DataTable
    columns={[kind === 'landing' ? 'Landing page' : kind === 'channel' ? 'Channel' : 'Source / medium / campaign / content', 'Visits', ...(compact ? [] : ['Signup clicks']), 'Verified signups', 'Signup rate']}
    rows={rows.filter(row => row.kind === kind).slice(0, limit).map(row => ({
      key: JSON.stringify([row.landing_path, row.channel, row.source, row.medium, row.campaign, row.content]),
      cells: [trafficLabel(row), formatCount(row.visits), ...(compact ? [] : [formatCount(row.signup_clicks)]), formatCount(row.signups), formatPercent(row.converted, row.visits, 1)],
    }))}
    empty="No traffic recorded in this period."
  />;
}

export function AdminDiscoveryOverview() {
  const traffic = useDiscovery();
  return <Card title="Discovery" aside={<Link className="link-sm" to="/admin/discovery">View discovery report</Link>}>
    <p className="small muted">Last 28 days compared with the previous 28 days.</p>
    <DiscoveryKpis current={traffic.data?.current} prior={traffic.data?.prior} />
    {traffic.isPending && <Loading />}
    {traffic.isError && <div className="row"><ErrorNote message={adminErrorText(traffic.error)} /><button type="button" className="btn sm" onClick={() => void traffic.refetch()}>Retry traffic</button></div>}
    {traffic.data && <div className="cols2">
      <section className="stack"><h3 className="h2">Top landing pages</h3><TrafficTable rows={traffic.data.breakdown} kind="landing" limit={3} compact /></section>
      <section className="stack"><h3 className="h2">Top sources and campaigns</h3><TrafficTable rows={traffic.data.breakdown} kind="campaign" limit={3} compact /></section>
    </div>}
  </Card>;
}

export default function AdminDiscoveryPage() {
  const traffic = useDiscovery();
  return <>
    <PageHead title="Discovery" sub="See how people find Mova, where they land, and which visits lead to a verified stylist account." actions={<Link className="btn sm" to="/admin">Overview</Link>} />
    <DiscoveryKpis current={traffic.data?.current} prior={traffic.data?.prior} />
    {traffic.isPending && <Loading />}
    {traffic.isError && <div className="row"><ErrorNote message={adminErrorText(traffic.error)} /><button type="button" className="btn sm" onClick={() => void traffic.refetch()}>Retry traffic</button></div>}
    {traffic.data && <>
      <Card title="Campaign traffic today">
        <p className="small muted">Visits so far today (UTC). The 28-day comparison uses completed days.</p>
        <TrafficTable rows={traffic.data.today_campaigns ?? []} kind="campaign" />
      </Card>
      <Card title="Landing page conversion">
        <p className="small muted">28 days through {traffic.data.through} UTC. The landing page and campaign that started the visit get credit. Signup rate is the share of visits with at least one verified stylist signup.</p>
        <TrafficTable rows={traffic.data.breakdown} kind="landing" />
      </Card>
      <Card title="Website page traffic">
        <DataTable columns={['Page', 'Page views', 'Visits with a view']} rows={traffic.data.pages.map(row => ({
          key: row.path, cells: [row.path, formatCount(row.views), formatCount(row.visits)],
        }))} empty="No page views recorded in this period." />
      </Card>
      <Card title="Channels and campaigns">
        <div className="stack"><TrafficTable rows={traffic.data.breakdown} kind="channel" /><TrafficTable rows={traffic.data.breakdown} kind="campaign" /></div>
      </Card>
      <Card title="Calculator acquisition">
        <p className="small muted">Activity in the same 28-day reporting window from the calculator’s existing counters.</p>
        <div className="k3">
          <Kpi label="Calculator uses" value={formatCount(traffic.data.calculator.used)} />
          <Kpi label="Start free clicks" value={formatCount(traffic.data.calculator.signup_clicks)} />
          <Kpi label="Verified signups" value={formatCount(traffic.data.calculator.signups)} />
        </div>
      </Card>
    </>}
  </>;
}
