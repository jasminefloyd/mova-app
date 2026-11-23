import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type ActivityPage, type ActivityRow } from './admin-api';
import { downloadText, formatCount, formatDateTime, toCsv } from './admin-format';
import { Empty, ErrorNote, Loading, PageHead } from './AdminPrimitives';

// A11: plain words for each logged action (the raw key stays available in the export).
const actionLabels: Record<string, string> = {
  'admin.signed_in': 'Signed in', 'audit.exported': 'Exported an audit log', 'logs.viewed': 'Viewed system logs', 'stylist.viewed': 'Viewed a stylist',
  'blog.published': 'Published a guide', 'blog.scheduled': 'Scheduled a guide', 'blog.saved_draft': 'Saved a guide draft', 'blog.unpublished': 'Unpublished a guide', 'blog.deleted_draft': 'Deleted a guide draft',
  'fee.platform_default_set': 'Changed the platform fee', 'fee.stylist_rate_set': 'Changed a fee', 'fee.override_created': 'Changed a fee',
  'job.requeued': 'Re-ran a background job', 'switch.updated': 'Changed a feature switch',
  'stylist.feature_override.updated': 'Changed a stylist feature', 'stylist.runtime_switch.updated': 'Changed a stylist setting', 'stylist.plan_assigned': 'Changed a plan',
  'stylist.page_unpublished': 'Unpublished a page', 'stylist.suspended': 'Suspended a stylist', 'stylist.restored': 'Restored a stylist',
  'stylist.trial_extended': 'Extended a free trial', 'stylist.trial_ended': 'Ended a free trial', 'stylist.trial_released': 'Granted a new free trial',
  'support.replied': 'Replied to support', 'support.status_changed': 'Changed a support status', 'export.audit': 'Exported an audit log',
};
const actionLabel = (key: string) => actionLabels[key] ?? key.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const ranges = [{ value: 'all', label: 'All time', days: null }, { value: '7', label: 'Last 7 days', days: 7 }, { value: '30', label: 'Last 30 days', days: 30 }, { value: '90', label: 'Last 90 days', days: 90 }] as const;
const detailsText = (row: ActivityRow) => {
  const details = (row as ActivityRow & { details?: Record<string, unknown> }).details ?? {};
  return Object.entries(details).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object').slice(0, 3).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ');
};

export default function AdminActivityPage() {
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [range, setRange] = useState<(typeof ranges)[number]['value']>('all');
  const [action, setAction] = useState('');
  const [older, setOlder] = useState<ActivityRow[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const from = (() => { const days = ranges.find((item) => item.value === range)?.days; return days ? new Date(Date.now() - days * 86_400_000).toISOString() : null; })();
  const args = { p_from: from, p_action: action || null, p_search: submitted || null, p_limit: 50 };
  const page = useQuery({
    queryKey: ['admin', 'activity', submitted, range, action],
    queryFn: () => adminRpc<ActivityPage>('mova_admin_activity_list', { ...args, p_before: null }),
  });
  const rows = [...(page.data?.rows ?? []), ...older];
  const last = rows[rows.length - 1];
  const reset = () => { setOlder([]); setOlderHasMore(null); };

  async function loadOlder() {
    if (!last) return;
    const next = await adminRpc<ActivityPage>('mova_admin_activity_list', { ...args, p_before: last.occurred_at });
    setOlder((current) => [...current, ...next.rows]);
    setOlderHasMore(next.has_more);
  }
  function exportCsv() {
    downloadText('mova-admin-activity.csv', toCsv(['When', 'Who', 'Action', 'Action key', 'Stylist', 'Reason', 'Details'], rows.map((row) => [row.occurred_at, row.admin_name, actionLabel(row.action), row.action, row.business_name ? `${row.business_name}${row.bid ? ` · BID-${row.bid}` : ''}` : '', row.reason ?? '', detailsText(row)])));
  }

  return (
    <>
      <PageHead title="Admin activity" sub="Everything staff did in this portal, newest first. This log cannot be edited."
        actions={<button type="button" className="btn sm" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>} />
      <form className="toolbar toolbar--search" onSubmit={(event) => { event.preventDefault(); reset(); setSubmitted(search.trim()); }}>
        <div className="search-field">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className="input" type="search" aria-label="Search admin activity" placeholder="Search by stylist or reason" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="select" aria-label="Date range" value={range} onChange={(event) => { reset(); setRange(event.target.value as typeof range); }}>{ranges.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <select className="select" aria-label="Action" value={action} onChange={(event) => { reset(); setAction(event.target.value); }}>
          <option value="">All actions</option>
          {Object.entries(actionLabels).filter(([key]) => !['fee.override_created', 'export.audit'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button type="submit" className="visually-hidden">Search</button>
      </form>
      <ErrorNote message={page.isError ? adminErrorText(page.error) : null} />
      {page.isPending ? <Loading /> : null}
      {page.data && rows.length === 0 ? <Empty>No activity matches.</Empty> : null}
      {rows.length > 0 ? (
        <div className="tbl-wrap admin-record-list"><table className="tbl">
          <thead><tr className="th"><th>When</th><th>Action</th><th>Stylist</th><th>Reason</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="tr">
                <td className="small">{formatDateTime(row.occurred_at)}<div className="muted">{row.admin_name}</div></td>
                <td><strong>{actionLabel(row.action)}</strong></td>
                <td>{row.business_name ? `${row.business_name}${row.bid ? ` · BID-${row.bid}` : ''}` : '—'}</td>
                <td className="small">{row.reason ?? '—'}</td>
                <td className="small muted">{detailsText(row) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}
      {rows.length > 0 ? <div className="admin-mobile-list">{rows.map((row) => <article className="admin-record" key={`mobile-${row.id}`}>
        <span><strong>{actionLabel(row.action)}</strong><small>{formatDateTime(row.occurred_at)} · {row.business_name ? `${row.business_name}${row.bid ? ` · BID-${row.bid}` : ''}` : row.admin_name}</small></span>
        <small>{row.reason ?? detailsText(row) ?? '—'}</small>
      </article>)}</div> : null}
      <p className="small muted">{formatCount(rows.length)} shown.</p>
      {(olderHasMore ?? page.data?.has_more) ? <button type="button" className="btn sm" onClick={() => void loadOlder()}>Load older</button> : null}
    </>
  );
}
