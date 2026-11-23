import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type StylistList, type StylistStatusKey } from './admin-api';
import { downloadText, formatCount, formatFeeBps, formatRelativeDay, toCsv } from './admin-format';
import { Empty, ErrorNote, Loading, PageHead, Pill, Segmented, type PillTone } from './AdminPrimitives';

type Filter = 'all' | 'active' | 'onboarding' | 'quiet' | 'restricted' | 'suspended';
const PAGE = 25;

const statusLabel: Record<StylistStatusKey, string> = { active: 'Active', onboarding: 'Onboarding', quiet: 'Quiet', suspended: 'Suspended' };
const statusTone: Record<StylistStatusKey, PillTone> = { active: 'ok', onboarding: 'warn', quiet: 'warn', suspended: 'bad' };
const stripeLabel = (status: string) => ({ active: 'Active', restricted: 'Restricted', pending: 'Pending', disconnected: 'Disconnected', not_connected: 'Not connected' } as Record<string, string>)[status] ?? (status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ') : 'Not connected');
const stripeTone = (status: string): PillTone => status === 'active' ? 'ok' : status === 'restricted' ? 'bad' : status === 'pending' ? 'warn' : 'off';

export default function AdminStylistsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useQuery({
    queryKey: ['admin', 'stylists', filter, submitted, offset],
    queryFn: () => adminRpc<StylistList>('mova_admin_stylists', { p_filter: filter, p_search: submitted || null, p_limit: PAGE, p_offset: offset }),
  });

  const counts = list.data?.counts;
  function exportCsv() {
    const rows = (list.data?.stylists ?? []).map((row) => [row.name, row.business_name, `BID-${row.bid}`, statusLabel[row.status_key], row.plan_name, stripeLabel(row.stripe_status), formatFeeBps(row.fee_bps), row.done_30d, row.last_booking_at ?? '']);
    downloadText(`mova-stylists-${filter}.csv`, toCsv(['Stylist', 'Business', 'BID', 'Status', 'Plan', 'Stripe', 'Fee', 'Done (30d)', 'Last booking'], rows));
  }
  const options: { value: Filter; label: string; count?: number | undefined }[] = [
    { value: 'all', label: 'All', count: counts?.all },
    { value: 'active', label: 'Active', count: counts?.active },
    { value: 'onboarding', label: 'Onboarding', count: counts?.onboarding },
    { value: 'quiet', label: 'Quiet', count: counts?.quiet },
    { value: 'restricted', label: 'Restricted Stripe', count: counts?.restricted },
    { value: 'suspended', label: 'Suspended', count: counts?.suspended },
  ];

  return (
    <>
      <PageHead title="Stylists" sub={counts ? `${formatCount(counts.all)} stylists. Search by name, business, handle or BID.` : 'Every stylist account on the platform.'}
        actions={<button type="button" className="btn sm" onClick={exportCsv} disabled={!list.data?.stylists.length}>Export CSV</button>} />
      <div className="toolbar toolbar--search">
        <form className="search-field" role="search" onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmitted(search.trim()); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className="input" type="search" aria-label="Search stylists" placeholder="Search stylists" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button type="submit" className="visually-hidden">Search</button>
        </form>
        <Segmented variant="chips" label="Stylist status" value={filter} onChange={(value) => { setFilter(value); setOffset(0); }} options={options} />
      </div>
      <ErrorNote message={list.isError ? adminErrorText(list.error) : null} />
      {list.isPending ? <Loading /> : null}
      {list.data && list.data.stylists.length === 0 ? <Empty>No stylists match this view.</Empty> : null}
      {list.data && list.data.stylists.length > 0 ? (
        <div className="tbl-wrap admin-record-list">
          <table className="tbl">
            <thead>
              <tr className="th"><th>Stylist</th><th>Status</th><th>Plan</th><th>Stripe</th><th>Fee</th><th className="num">Done (30d)</th><th>Last booking</th></tr>
            </thead>
            <tbody>
              {list.data.stylists.map((row) => (
                <tr key={row.id} className="tr">
                  <td><Link to={`/admin/stylists/${row.id}`}><strong>{row.name}</strong></Link><div className="small muted">{row.business_name} · BID-{row.bid}</div></td>
                  <td><Pill tone={statusTone[row.status_key]}>{statusLabel[row.status_key]}</Pill></td>
                  <td>{row.plan_name}</td>
                  <td><Pill tone={stripeTone(row.stripe_status)}>{stripeLabel(row.stripe_status)}</Pill></td>
                  <td>{formatFeeBps(row.fee_bps)}</td>
                  <td className="num"><strong>{formatCount(row.done_30d)}</strong></td>
                  <td>{row.last_booking_at ? formatRelativeDay(row.last_booking_at) : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager">
            <span className="small muted">Showing {formatCount(offset + 1)}–{formatCount(Math.min(offset + PAGE, list.data.total))} of {formatCount(list.data.total)}</span>
            <span className="row">
              <button type="button" className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <button type="button" className="btn sm" disabled={offset + PAGE >= list.data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </span>
          </div>
        </div>
      ) : null}
      {list.data && list.data.stylists.length > 0 ? <div className="admin-mobile-list">{list.data.stylists.map((row) => (
        <Link key={row.id} className="admin-record" to={`/admin/stylists/${row.id}`}>
          <span><strong>{row.name}</strong><small>{row.business_name} · BID-{row.bid}</small></span>
          <span className="admin-record__aside"><Pill tone={statusTone[row.status_key]}>{statusLabel[row.status_key]}</Pill></span>
          <small>{row.plan_name} · {formatFeeBps(row.fee_bps)} · {formatCount(row.done_30d)} done · {row.last_booking_at ? formatRelativeDay(row.last_booking_at) : 'No bookings'}</small>
        </Link>
      ))}<div className="admin-record admin-record-paging"><span>{formatCount(offset + 1)}–{formatCount(Math.min(offset + PAGE, list.data.total))} of {formatCount(list.data.total)}</span><span className="row"><button type="button" className="btn sm ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button><button type="button" className="btn sm ghost" disabled={offset + PAGE >= list.data.total} onClick={() => setOffset(offset + PAGE)}>Next</button></span></div></div> : null}
    </>
  );
}
