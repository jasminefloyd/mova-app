import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { adminErrorText, adminRpc } from './admin-api';
import { formatChange, formatCount, formatPercent } from './admin-format';
import { Card, ErrorNote, Kpi, Loading, PageHead, Segmented } from './AdminPrimitives';
import type { Discovery, DiscoveryRow, SearchDiscovery, SearchRow, VisitTotals } from './discovery-data';

function useDiscovery() {
  const traffic = useQuery({
    queryKey: ['admin', 'discovery'],
    queryFn: () => adminRpc<Discovery>('mova_admin_discovery'),
  });
  const search = useQuery({
    queryKey: ['admin', 'discovery-search'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SearchDiscovery> => {
      const { data } = await createMovaSupabaseClient().auth.getSession();
      if (!data.session) throw new Error('ADMIN_SESSION_REQUIRED');
      const response = await fetch('/api/admin-search-discovery', { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) throw new Error('SEARCH_CONSOLE_UNAVAILABLE');
      return response.json() as Promise<SearchDiscovery>;
    },
  });
  return { traffic, search };
}

function change(current: number | undefined, prior: number | undefined) {
  return current !== undefined && prior !== undefined ? `${formatChange(current, prior).text} vs prior 28 days` : undefined;
}

function DiscoveryKpis({ current, prior, search }: {
  current: VisitTotals | null | undefined; prior: VisitTotals | null | undefined; search: SearchDiscovery | undefined;
}) {
  const ready = search?.state === 'ready' ? search : undefined;
  const currentRate = current?.visits ? current.converted / current.visits : undefined;
  const priorRate = prior?.visits ? prior.converted / prior.visits : undefined;
  const metric = (value: number | undefined) => value === undefined ? '—' : formatCount(value);
  return <div className="k4">
    <Kpi label="Google Search clicks" value={metric(ready?.current?.clicks)} note={change(ready?.current?.clicks, ready?.prior?.clicks)} />
    <Kpi label="Website visits" value={metric(current?.visits)} note={change(current?.visits, prior?.visits)} />
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
  return [row.source, row.medium, row.campaign].map(value => value || '—').join(' / ');
}

function TrafficTable({ rows, kind, limit = 25, compact = false }: { rows: DiscoveryRow[]; kind: DiscoveryRow['kind']; limit?: number; compact?: boolean }) {
  return <DataTable
    columns={[kind === 'landing' ? 'Landing page' : kind === 'channel' ? 'Channel' : 'Source / medium / campaign', 'Visits', ...(compact ? [] : ['Signup clicks']), 'Verified signups', 'Signup rate']}
    rows={rows.filter(row => row.kind === kind).slice(0, limit).map(row => ({
      key: JSON.stringify([row.landing_path, row.channel, row.source, row.medium, row.campaign]),
      cells: [trafficLabel(row), formatCount(row.visits), ...(compact ? [] : [formatCount(row.signup_clicks)]), formatCount(row.signups), formatPercent(row.converted, row.visits, 1)],
    }))}
    empty="No traffic recorded in this period."
  />;
}

export function AdminDiscoveryOverview() {
  const { traffic, search } = useDiscovery();
  return <Card title="Discovery" aside={<Link className="link-sm" to="/admin/discovery">View discovery report</Link>}>
    <p className="small muted">Last 28 days compared with the previous 28 days. Search Console uses its latest finalized data.</p>
    <DiscoveryKpis current={traffic.data?.current} prior={traffic.data?.prior} search={search.data} />
    {traffic.isPending && <Loading />}
    {traffic.isError && <div className="row"><ErrorNote message={adminErrorText(traffic.error)} /><button type="button" className="btn sm" onClick={() => void traffic.refetch()}>Retry traffic</button></div>}
    {search.data?.state === 'not_configured' && <p className="small muted">Connect Google Search Console to see organic search data.</p>}
    {(search.isError || search.data?.state === 'unavailable') && <p className="small muted">Search Console data is temporarily unavailable.</p>}
    {traffic.data && <div className="cols2">
      <section className="stack"><h3 className="h2">Top landing pages</h3><TrafficTable rows={traffic.data.breakdown} kind="landing" limit={3} compact /></section>
      <section className="stack"><h3 className="h2">Top sources and campaigns</h3><TrafficTable rows={traffic.data.breakdown} kind="campaign" limit={3} compact /></section>
    </div>}
  </Card>;
}

function resultPage(value: string | undefined) {
  if (!value) return '—';
  try {
    const url = new URL(value);
    return url.pathname + url.search;
  } catch { return value; }
}

function searchCells(row: SearchRow) {
  return [formatCount(row.clicks), formatCount(row.impressions), formatPercent(row.ctr, 1, 1), row.impressions ? row.position.toFixed(1) : '—'];
}
function isBranded(query: string) {
  return /\b(?:mova|movabeauty)\b/i.test(query);
}

export default function AdminDiscoveryPage() {
  const { traffic, search } = useDiscovery();
  const [terms, setTerms] = useState<'all' | 'branded' | 'unbranded'>('all');
  const detail = search.data?.state === 'ready' ? search.data : undefined;
  return <>
    <PageHead title="Discovery" sub="See how people find Mova, where they land, and which visits lead to a verified stylist account." actions={<Link className="btn sm" to="/admin">Overview</Link>} />
    <DiscoveryKpis current={traffic.data?.current} prior={traffic.data?.prior} search={search.data} />
    <Card title="Google Search">
      {search.isPending && <Loading />}
      {search.data?.state === 'not_configured' && <p className="muted">Google Search Console is not connected. Website traffic and signups are reported below.</p>}
      {(search.isError || search.data?.state === 'unavailable') && <div className="row"><ErrorNote message="Search Console data is unavailable. Check the connection or try again." /><button type="button" className="btn sm" onClick={() => void search.refetch()}>Retry Search Console</button></div>}
      {detail && <>
        <p className="small muted">{detail.start} to {detail.through} · finalized Google Search data. Search query results are aggregated.</p>
        <div className="k3">
          <Kpi label="Impressions" value={formatCount(detail.current?.impressions)} note={change(detail.current?.impressions, detail.prior?.impressions)} />
          <Kpi label="Click-through rate" value={detail.current?.impressions ? formatPercent(detail.current.ctr, 1, 1) : '—'} />
          <Kpi label="Average position" value={detail.current?.impressions ? detail.current.position.toFixed(1) : '—'} />
        </div>
        <div className="stack">
          <h3 className="h2">Top organic pages</h3>
          <DataTable columns={['Page', 'Clicks', 'Impressions', 'CTR', 'Position']} rows={detail.pages.map(row => ({
            key: JSON.stringify(row.keys), cells: [resultPage(row.keys[0]), ...searchCells(row)],
          }))} empty="No organic page data in this period." />
          <h3 className="h2">Top queries and pages shown</h3>
          <Segmented label="Search query type" value={terms} onChange={setTerms} options={[{ value: 'all', label: 'All' }, { value: 'branded', label: 'Branded' }, { value: 'unbranded', label: 'Unbranded' }]} />
          <DataTable columns={['Search query', 'Page shown', 'Clicks', 'Impressions', 'CTR', 'Position']} rows={detail.terms
            .filter(row => terms === 'all' || isBranded(row.keys[0] ?? '') === (terms === 'branded'))
            .map(row => ({ key: JSON.stringify(row.keys), cells: [row.keys[0], resultPage(row.keys[1]), ...searchCells(row)] }))}
            empty="No matching queries among the top reported results." />
        </div>
      </>}
    </Card>
    {traffic.isPending && <Loading />}
    {traffic.isError && <div className="row"><ErrorNote message={adminErrorText(traffic.error)} /><button type="button" className="btn sm" onClick={() => void traffic.refetch()}>Retry traffic</button></div>}
    {traffic.data && <>
      <Card title="Landing page conversion">
        <p className="small muted">28 days through {traffic.data.through} UTC. The first page and campaign in a visit get credit. Signup rate is the share of visits with at least one verified stylist signup.</p>
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
