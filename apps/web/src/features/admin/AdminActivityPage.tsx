import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type ActivityPage, type ActivityRow } from './admin-api';
import { formatCount, formatDateTime } from './admin-format';
import { Empty, ErrorNote, Loading, PageHead } from './AdminPrimitives';

export default function AdminActivityPage() {
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [older, setOlder] = useState<ActivityRow[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const page = useQuery({
    queryKey: ['admin', 'activity', submitted],
    queryFn: () => adminRpc<ActivityPage>('mova_admin_activity_list', { p_from: null, p_action: null, p_search: submitted || null, p_limit: 50, p_before: null }),
  });
  const rows = [...(page.data?.rows ?? []), ...older];
  const last = rows[rows.length - 1];

  async function loadOlder() {
    if (!last) return;
    const next = await adminRpc<ActivityPage>('mova_admin_activity_list', { p_from: null, p_action: null, p_search: submitted || null, p_limit: 50, p_before: last.occurred_at });
    setOlder((current) => [...current, ...next.rows]);
    setOlderHasMore(next.has_more);
  }

  return (
    <>
      <PageHead title="Admin activity" sub="Everything staff did in this portal, newest first. This log cannot be edited." />
      <form className="toolbar row" onSubmit={(event) => { event.preventDefault(); setOlder([]); setOlderHasMore(null); setSubmitted(search.trim()); }}>
        <input className="input" type="search" aria-label="Search admin activity" placeholder="Search by action, stylist or reason" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button type="submit" className="btn sm ghost">Search</button>
      </form>
      <ErrorNote message={page.isError ? adminErrorText(page.error) : null} />
      {page.isPending ? <Loading /> : null}
      {page.data && rows.length === 0 ? <Empty>No activity matches.</Empty> : null}
      {rows.length > 0 ? (
        <div className="tbl-wrap admin-record-list"><table className="tbl">
          <thead><tr className="th"><th>When</th><th>Who</th><th>Action</th><th>Stylist</th><th>Reason</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="tr">
                <td className="small">{formatDateTime(row.occurred_at)}</td>
                <td>{row.admin_name}</td>
                <td>{row.action}<div className="small muted">{row.object_type}{row.object_id ? ` · ${row.object_id.slice(0, 8)}` : ''}</div></td>
                <td>{row.business_name ? `${row.business_name}${row.bid ? ` · B${row.bid}` : ''}` : '—'}</td>
                <td className="small">{row.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}
      {rows.length > 0 ? <div className="admin-mobile-list">{rows.map((row) => <article className="admin-record" key={`mobile-${row.id}`}>
        <span><strong>{row.action}</strong><small>{formatDateTime(row.occurred_at)} · {row.business_name ? `${row.business_name}${row.bid ? ` · BID-${row.bid}` : ''}` : row.admin_name}</small></span>
        <span className="admin-record__aside">{row.object_type}</span><small>{row.reason ?? '—'}</small>
      </article>)}</div> : null}
      <p className="small muted">{formatCount(rows.length)} shown.</p>
      {(olderHasMore ?? page.data?.has_more) ? <button type="button" className="btn sm ghost" onClick={() => void loadOlder()}>Load older</button> : null}
    </>
  );
}
