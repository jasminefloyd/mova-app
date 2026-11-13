import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Fragment } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type SystemLogPage, type SystemLogRow } from './admin-api';
import { formatDateTime } from './admin-format';
import { Empty, ErrorNote, Loading, PageHead, Pill } from './AdminPrimitives';

const sources = ['web', 'function', 'database', 'auth', 'webhook', 'job', 'provider'] as const;
const cleanCell = (v: unknown) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();
function rowText(row: SystemLogRow): string {
  return [formatDateTime(row.occurred_at), row.level.toUpperCase(), row.source, row.event_name,
    row.business_name ? `${row.business_name}${row.bid ? ` · B${row.bid}` : ''}` : '',
    row.http_status ?? '', row.message, row.request_id ? `request ${row.request_id}` : '', row.error_code ?? ''].filter(Boolean).map(cleanCell).join(' | ');
}
function csvCell(v: unknown): string {
  let text = cleanCell(v);
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function AdminLogsPage() {
  const [searchParams] = useSearchParams();
  const requestedRange = searchParams.get('range') ?? '24h';
  const initialRange = ['24h', '7d', '30d'].includes(requestedRange) ? requestedRange : '24h';
  const requestedLevel = searchParams.get('level') ?? '';
  const initialLevel = ['info', 'warning', 'error'].includes(requestedLevel) ? requestedLevel : '';
  const requestedSource = searchParams.get('source') ?? '';
  const initialSource = sources.includes(requestedSource as typeof sources[number]) ? requestedSource : '';
  const initialStylist = searchParams.get('stylist') ?? '';
  const [range, setRange] = useState(initialRange);
  const [level, setLevel] = useState(initialLevel);
  const [source, setSource] = useState(initialSource);
  const [stylist, setStylist] = useState(initialStylist);
  const [userId, setUserId] = useState(searchParams.get('user') ?? '');
  const [requestId, setRequestId] = useState(searchParams.get('request_id') ?? '');
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState({ stylist: initialStylist, userId: searchParams.get('user') ?? '', requestId: searchParams.get('request_id') ?? '', text: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const from = useMemo(() => new Date(Date.now() - ({ '24h': 1, '7d': 7, '30d': 30 }[range] ?? 1) * 86_400_000).toISOString(), [range]);
  const filters = { range, level, source, ...submitted };
  const page = useQuery({ queryKey: ['admin', 'logs', filters], queryFn: () => adminRpc<SystemLogPage>('mova_admin_logs_search', {
    p_from: from, p_to: null, p_level: level || null, p_source: source || null,
    p_stylist: submitted.stylist || null, p_business_id: null, p_user_id: submitted.userId || null,
    p_request_id: submitted.requestId || null, p_search: submitted.text || null, p_limit: 200, p_before: null,
  }) });
  const rows = page.data?.rows ?? [];

  async function recordAction(count: number, format: 'text' | 'csv' | 'view') {
    await adminRpc('mova_admin_logs_exported', { p_count: count, p_format: format });
  }
  async function copyOne(row: SystemLogRow) {
    await navigator.clipboard.writeText(rowText(row));
    await recordAction(1, 'text');
  }
  async function copyResults() {
    if (rows.length > 200) return;
    await navigator.clipboard.writeText(rows.map(rowText).join('\n'));
    await recordAction(rows.length, 'text');
  }
  async function exportCsv() {
    const result = await adminRpc<SystemLogPage>('mova_admin_logs_search', {
      p_from: from, p_to: null, p_level: level || null, p_source: source || null,
      p_stylist: submitted.stylist || null, p_business_id: null, p_user_id: submitted.userId || null,
      p_request_id: submitted.requestId || null, p_search: submitted.text || null, p_limit: 1000, p_before: null,
    });
    const header = ['time', 'level', 'source', 'event', 'request_id', 'route_or_function', 'status', 'duration_ms', 'user_id', 'stylist', 'BID', 'client_id', 'error_code', 'message'];
    const csv = [header, ...result.rows.map((r) => [r.occurred_at, r.level, r.source, r.event_name, r.request_id, r.route_or_function, r.http_status, r.duration_ms, r.user_id, r.business_name, r.bid, r.client_id, r.error_code, r.message])].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'mova-system-logs.csv'; anchor.click(); URL.revokeObjectURL(url);
    await recordAction(result.rows.length, 'csv');
  }
  function applyFilters(event: FormEvent) {
    event.preventDefault(); setSubmitted({ stylist: stylist.trim(), userId: userId.trim(), requestId: requestId.trim(), text: text.trim() });
  }

  return <>
    <PageHead title="System logs" sub="Operational events from the app and platform. Sensitive payloads are excluded; full detail is available by request ID." actions={<><button className="btn sm ghost" type="button" onClick={() => void copyResults()} disabled={rows.length === 0 || rows.length > 200}>Copy results (up to 200)</button><button className="btn sm ghost" type="button" onClick={() => void exportCsv()}>Export CSV (up to 1,000)</button></>} />
    <form className="toolbar logs-filters" onSubmit={applyFilters}>
      <label><span className="lbl">Time range</span><select className="input" value={range} onChange={(e) => setRange(e.target.value)}><option value="24h">24 hours</option><option value="7d">7 days</option><option value="30d">30 days</option></select></label>
      <label><span className="lbl">Level</span><select className="input" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">All levels</option><option>info</option><option>warning</option><option>error</option></select></label>
      <label><span className="lbl">Source</span><select className="input" value={source} onChange={(e) => setSource(e.target.value)}><option value="">All sources</option>{sources.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label><span className="lbl">Stylist or BID</span><input className="input" value={stylist} onChange={(e) => setStylist(e.target.value)} /></label>
      <label><span className="lbl">User ID</span><input className="input" value={userId} onChange={(e) => setUserId(e.target.value)} /></label>
      <label><span className="lbl">Request ID</span><input className="input" value={requestId} onChange={(e) => setRequestId(e.target.value)} /></label>
      <label className="logs-search"><span className="lbl">Search</span><input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Event, error code or message" /></label>
      <button className="btn sm pri" type="submit">Apply filters</button>
    </form>
    <ErrorNote message={page.isError ? adminErrorText(page.error) : null} />
    {page.isPending ? <Loading /> : null}
    {page.data && rows.length === 0 ? <Empty>No logs match these filters.</Empty> : null}
    {rows.length ? <div className="logs-table-wrap"><table className="tbl logs-table"><thead><tr className="th"><th>Time</th><th>Level</th><th>Source · event</th><th>Stylist</th><th>Status</th><th>Message</th><th>Actions</th></tr></thead><tbody>
      {rows.map((row) => <Fragment key={row.id}>
        <tr key={row.id} className="tr">
          <td className="small">{formatDateTime(row.occurred_at)}</td><td><Pill tone={row.level === 'error' ? 'bad' : row.level === 'warning' ? 'warn' : 'ok'}>{row.level}</Pill></td>
          <td>{row.source}<div className="small muted">{row.event_name}{row.route_or_function ? ` · ${row.route_or_function}` : ''}</div></td>
          <td>{row.business_name ? `${row.business_name}${row.bid ? ` · B${row.bid}` : ''}` : '—'}</td>
          <td>{row.http_status ?? '—'}{row.duration_ms !== null ? <div className="small muted">{row.duration_ms} ms</div> : null}</td>
          <td>{row.message || row.error_code || '—'}</td>
          <td><div className="row"><button className="btn sm ghost" type="button" onClick={() => { const next = selected === row.id ? null : row.id; setSelected(next); if (next) void recordAction(1, 'view'); }}>{selected === row.id ? 'Hide' : 'Details'}</button><button className="btn sm ghost" type="button" onClick={() => void copyOne(row)}>Copy</button></div></td>
        </tr>
        {selected === row.id ? <tr key={`${row.id}-detail`} className="tr"><td colSpan={7}><div className="logs-detail"><strong>Request:</strong> {row.request_id ?? '—'} · <strong>User:</strong> {row.user_id ?? '—'} · <strong>Client:</strong> {row.client_id ?? '—'}<br /><strong>Error:</strong> {row.error_code ?? '—'}<br /><strong>Context:</strong> <code>{JSON.stringify(row.context)}</code></div></td></tr> : null}
      </Fragment>)}</tbody></table></div> : null}
    <p className="small muted">Info logs are retained for 30 days. Warnings and errors are retained for 90 days. Search returns at most 200 rows; CSV pulls up to 1,000.</p>
  </>;
}
