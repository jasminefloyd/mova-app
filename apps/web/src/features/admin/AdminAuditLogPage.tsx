import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type AuditEvent, type AuditPage } from './admin-api';
import { downloadText, formatDateTime, toCsv } from './admin-format';
import { Empty, ErrorNote, Loading, PageHead, Segmented } from './AdminPrimitives';

type Category = 'all' | 'bookings' | 'payments' | 'messages' | 'settings' | 'sign_ins' | 'admin' | 'errors';
const categories: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'bookings', label: 'Bookings' }, { value: 'payments', label: 'Payments' },
  { value: 'messages', label: 'Messages' }, { value: 'settings', label: 'Settings' }, { value: 'sign_ins', label: 'Sign-ins' },
  { value: 'admin', label: 'Admin actions' }, { value: 'errors', label: 'Errors' },
];

export default function AdminAuditLogPage() {
  const { businessId = '' } = useParams();
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [older, setOlder] = useState<AuditEvent[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const page = useQuery({
    queryKey: ['admin', 'audit', businessId, category, submitted],
    queryFn: () => adminRpc<AuditPage>('mova_admin_audit_events', { p_business_id: businessId, p_from: null, p_to: null, p_category: category, p_search: submitted || null, p_limit: 50, p_before: null }),
    enabled: businessId.length > 0,
  });

  const events = [...(page.data?.events ?? []), ...older];
  const last = events[events.length - 1];

  async function loadOlder() {
    if (!last) return;
    const next = await adminRpc<AuditPage>('mova_admin_audit_events', { p_business_id: businessId, p_from: null, p_to: null, p_category: category, p_search: submitted || null, p_limit: 50, p_before: last.occurred_at });
    setOlder((current) => [...current, ...next.events]);
    setOlderHasMore(next.has_more);
  }

  async function exportCsv() {
    setExportError(null);
    try {
      await adminRpc('mova_admin_log_audit_export', { p_business_id: businessId, p_row_count: events.length, p_include_contacts: false });
      downloadText(`mova-audit-${businessId.slice(0, 8)}.csv`, toCsv(['When (ET)', 'Category', 'Who', 'Event', 'Reference', 'Summary'], events.map((e) => [formatDateTime(e.occurred_at), e.category, e.actor, e.event, e.reference, e.summary])));
    } catch (error) {
      setExportError(adminErrorText(error));
    }
  }

  const hasMore = olderHasMore ?? page.data?.has_more ?? false;

  return (
    <>
      <PageHead
        title="Audit log"
        sub={<>Everything that happened on this account, newest first. <Link to={`/admin/stylists/${businessId}`}>Back to stylist</Link></>}
        actions={<button type="button" className="btn sm ghost" onClick={() => void exportCsv()} disabled={events.length === 0}>Export CSV</button>}
      />
      <div className="toolbar">
        <Segmented label="Category" value={category} onChange={(value) => { setCategory(value); setOlder([]); setOlderHasMore(null); }} options={categories} />
        <form className="row" onSubmit={(event) => { event.preventDefault(); setOlder([]); setOlderHasMore(null); setSubmitted(search.trim()); }}>
          <input className="input" type="search" aria-label="Search audit log" placeholder="Search events" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button type="submit" className="btn sm ghost">Search</button>
        </form>
      </div>
      <ErrorNote message={page.isError ? adminErrorText(page.error) : exportError} />
      {page.isPending ? <Loading /> : null}
      {page.data && events.length === 0 ? <Empty>No events match this view.</Empty> : null}
      {events.length > 0 ? (
        <div className="tbl-wrap admin-record-list"><table className="tbl">
          <thead><tr className="th"><th>When</th><th>Category</th><th>Who</th><th>Event</th><th>Summary</th></tr></thead>
          <tbody>
            {events.map((event, index) => (
              <tr key={`${event.occurred_at}-${event.reference}-${index}`} className="tr">
                <td className="small">{formatDateTime(event.occurred_at)}</td>
                <td>{event.category}</td>
                <td>{event.actor}</td>
                <td>{event.event} <span className="small muted">{event.reference}</span></td>
                <td className="small">{event.summary}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}
      {events.length > 0 ? <div className="admin-mobile-list">{events.map((event, index) => <article key={`mobile-${event.occurred_at}-${event.reference}-${index}`} className="admin-record">
        <span><strong>{event.summary}</strong><small>{formatDateTime(event.occurred_at)} · {event.actor}</small></span>
        <span className="admin-record__aside">{event.category}</span><small className="mono">{event.event} · {event.reference}</small>
      </article>)}</div> : null}
      {hasMore ? <button type="button" className="btn sm ghost" onClick={() => void loadOlder()}>Load older events</button> : null}
    </>
  );
}
