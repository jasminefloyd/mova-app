import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type AuditEvent, type AuditPage, type StylistDetail } from './admin-api';
import { downloadText, formatDateTime, toCsv } from './admin-format';
import { Empty, ErrorNote, Loading, PageHead, Pill, Segmented, type PillTone } from './AdminPrimitives';

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
  const [exportOpen, setExportOpen] = useState(false);
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [who, setWho] = useState('');
  const detail = useQuery({ queryKey: ['admin', 'stylist', businessId], queryFn: () => adminRpc<StylistDetail>('mova_admin_stylist_detail', { p_business_id: businessId }), enabled: businessId.length > 0 });
  const range = { p_from: fromDay ? new Date(`${fromDay}T00:00:00`).toISOString() : null, p_to: toDay ? new Date(`${toDay}T23:59:59`).toISOString() : null };
  const page = useQuery({
    queryKey: ['admin', 'audit', businessId, category, submitted, fromDay, toDay],
    queryFn: () => adminRpc<AuditPage>('mova_admin_audit_events', { p_business_id: businessId, ...range, p_category: category, p_search: submitted || null, p_limit: 50, p_before: null }),
    enabled: businessId.length > 0,
  });

  const allEvents = [...(page.data?.events ?? []), ...older];
  const events = who ? allEvents.filter((event) => event.actor === who) : allEvents;
  const actors = [...new Set(allEvents.map((event) => event.actor))];
  const last = events[events.length - 1];

  async function loadOlder() {
    if (!last) return;
    const next = await adminRpc<AuditPage>('mova_admin_audit_events', { p_business_id: businessId, ...range, p_category: category, p_search: submitted || null, p_limit: 50, p_before: last.occurred_at });
    setOlder((current) => [...current, ...next.events]);
    setOlderHasMore(next.has_more);
  }

  async function exportCsv() {
    setExportError(null);
    try {
      await adminRpc('mova_admin_log_audit_export', { p_business_id: businessId, p_row_count: events.length, p_include_contacts: false });
      setExportOpen(false);
      downloadText(`mova-audit-${businessId.slice(0, 8)}.csv`, toCsv(['When (ET)', 'Category', 'Who', 'Event', 'Reference', 'Summary'], events.map((e) => [formatDateTime(e.occurred_at), e.category, e.actor, e.event, e.reference, e.summary])));
    } catch (error) {
      setExportError(adminErrorText(error));
    }
  }

  const hasMore = olderHasMore ?? page.data?.has_more ?? false;

  const businessName = detail.data?.business.name ?? 'this stylist';
  const reset = () => { setOlder([]); setOlderHasMore(null); };
  const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date(iso));
  const timeLabel = (iso: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(iso));
  const whoTone = (actor: string): PillTone => actor === 'Admin' ? 'new' : actor === 'Client' ? 'warn' : actor === 'Stylist' ? 'ok' : 'off';
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/admin/stylists">Stylists</Link><span aria-hidden="true">›</span><Link to={`/admin/stylists/${businessId}`}>{detail.data?.profile?.display_name ?? 'Stylist'}</Link><span aria-hidden="true">›</span><span aria-current="page">Audit log</span></nav>
      <PageHead
        title={`Audit log · ${businessName}`}
        sub={`Everything that happened on this account, newest first.${events.length ? ` ${events.length} events shown.` : ''}`}
        actions={<button type="button" className="btn pri sm" onClick={() => setExportOpen(true)} disabled={events.length === 0}>Export CSV</button>}
      />
      {/* A5: export panel, then the filters (dates, type, who, search) and the type chips. */}
      {exportOpen ? <section className="card export-panel" aria-labelledby="export-title">
        <div><h2 className="h2" id="export-title">Export {events.length} events as CSV</h2><p className="small muted">Client IDs (CID) are included; client phone numbers and emails are not part of the audit log. The export is recorded in admin activity.</p></div>
        <span className="row"><button type="button" className="btn sm" onClick={() => setExportOpen(false)}>Cancel</button><button type="button" className="btn pri sm" onClick={() => void exportCsv()}>Download CSV</button></span>
      </section> : null}
      <form className="audit-filters" onSubmit={(event) => { event.preventDefault(); reset(); setSubmitted(search.trim()); }}>
        <label className="field"><span className="visually-hidden">From</span><input className="input" type="date" aria-label="From" value={fromDay} onChange={(event) => { reset(); setFromDay(event.target.value); }} /></label>
        <label className="field"><span className="visually-hidden">To</span><input className="input" type="date" aria-label="To" value={toDay} onChange={(event) => { reset(); setToDay(event.target.value); }} /></label>
        <select className="select" aria-label="Who" value={who} onChange={(event) => setWho(event.target.value)}><option value="">Who: Anyone</option>{actors.map((actor) => <option key={actor} value={actor}>{actor}</option>)}</select>
        <div className="search-field"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className="input" type="search" aria-label="Search audit log" placeholder="Search AID, CID or text" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <button type="submit" className="visually-hidden">Search</button>
      </form>
      <Segmented variant="chips" label="Category" value={category} onChange={(value) => { setCategory(value); reset(); }} options={categories} />
      <ErrorNote message={page.isError ? adminErrorText(page.error) : exportError} />
      {page.isPending ? <Loading /> : null}
      {page.data && events.length === 0 ? <Empty>No events match this view.</Empty> : null}
      {events.length > 0 ? (
        <div className="tbl-wrap admin-record-list"><table className="tbl">
          <thead><tr className="th"><th>Time</th><th>Who</th><th>Event</th><th>Details</th><th>Reference</th></tr></thead>
          <tbody>
            {events.map((event, index) => {
              const day = dayLabel(event.occurred_at);
              const newDay = index === 0 || dayLabel(events[index - 1]!.occurred_at) !== day;
              return <Fragment key={`${event.occurred_at}-${event.reference}-${index}`}>
                {newDay ? <tr className="tr day-row"><td colSpan={5}>{day}</td></tr> : null}
                <tr className="tr">
                  <td className="small">{timeLabel(event.occurred_at)}</td>
                  <td><Pill tone={whoTone(event.actor)}>{event.actor}</Pill></td>
                  <td className="mono small">{event.event}</td>
                  <td><strong>{event.summary}</strong></td>
                  <td className="mono small">{event.reference || '—'}</td>
                </tr>
              </Fragment>;
            })}
          </tbody>
        </table></div>
      ) : null}
      {events.length > 0 ? <div className="admin-mobile-list">{events.map((event, index) => <article key={`mobile-${event.occurred_at}-${event.reference}-${index}`} className="admin-record">
        <span><strong>{event.summary}</strong><small>{formatDateTime(event.occurred_at)} · {event.actor}</small></span>
        <span className="admin-record__aside">{event.category}</span><small className="mono">{event.event} · {event.reference}</small>
      </article>)}</div> : null}
      {hasMore ? <button type="button" className="btn sm center" onClick={() => void loadOlder()}>Load older events</button> : null}
    </>
  );
}
