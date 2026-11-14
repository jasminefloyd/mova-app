import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type StylistList, type StylistStatusKey } from './admin-api';
import { formatCount, formatFeeBps, formatRelativeDay } from './admin-format';
import { Empty, ErrorNote, Loading, PageHead, Pill, Segmented, type PillTone } from './AdminPrimitives';

type Filter = 'all' | 'active' | 'onboarding' | 'quiet' | 'restricted' | 'suspended';
const PAGE = 25;

const statusLabel: Record<StylistStatusKey, string> = { active: 'Active', onboarding: 'Onboarding', quiet: 'Quiet', suspended: 'Suspended' };
const statusTone: Record<StylistStatusKey, PillTone> = { active: 'ok', onboarding: 'new', quiet: 'warn', suspended: 'bad' };

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
  const options: { value: Filter; label: string; count?: number | undefined }[] = [
    { value: 'all', label: 'All', count: counts?.all },
    { value: 'active', label: 'Active', count: counts?.active },
    { value: 'onboarding', label: 'Onboarding', count: counts?.onboarding },
    { value: 'quiet', label: 'Quiet', count: counts?.quiet },
    { value: 'restricted', label: 'Payouts restricted', count: counts?.restricted },
    { value: 'suspended', label: 'Suspended', count: counts?.suspended },
  ];

  return (
    <>
      <PageHead title="Stylists" sub={counts ? `${formatCount(counts.all)} stylists on the platform.` : 'Every stylist account on the platform.'} />
      <div className="toolbar">
        <Segmented label="Stylist status" value={filter} onChange={(value) => { setFilter(value); setOffset(0); }} options={options} />
        <form className="row" onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmitted(search.trim()); }}>
          <input className="input" type="search" aria-label="Search stylists" placeholder="Name, business, handle or B-number" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button type="submit" className="btn sm ghost">Search</button>
        </form>
      </div>
      <ErrorNote message={list.isError ? adminErrorText(list.error) : null} />
      {list.isPending ? <Loading /> : null}
      {list.data && list.data.stylists.length === 0 ? <Empty>No stylists match this view.</Empty> : null}
      {list.data && list.data.stylists.length > 0 ? (
        <div className="tbl-wrap admin-record-list">
          <table className="tbl">
            <thead>
              <tr className="th"><th>Stylist</th><th>Status</th><th>Plan</th><th>Fee</th><th>Done (30d)</th><th>Last booking</th></tr>
            </thead>
            <tbody>
              {list.data.stylists.map((row) => (
                <tr key={row.id} className="tr">
                  <td><Link to={`/admin/stylists/${row.id}`}>{row.name}</Link><div className="small muted">{row.business_name} · B{row.bid}{row.handle ? ` · @${row.handle}` : ''}</div></td>
                  <td><Pill tone={statusTone[row.status_key]}>{statusLabel[row.status_key]}</Pill>{row.stripe_status === 'restricted' ? <Pill tone="bad">Payouts restricted</Pill> : null}</td>
                  <td>{row.plan_name}</td>
                  <td className="mono">{formatFeeBps(row.fee_bps)}</td>
                  <td className="mono">{formatCount(row.done_30d)}</td>
                  <td>{row.last_booking_at ? formatRelativeDay(row.last_booking_at) : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="btn sm ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <span className="small muted">{formatCount(offset + 1)}–{formatCount(Math.min(offset + PAGE, list.data.total))} of {formatCount(list.data.total)}</span>
            <button type="button" className="btn sm ghost" disabled={offset + PAGE >= list.data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
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
