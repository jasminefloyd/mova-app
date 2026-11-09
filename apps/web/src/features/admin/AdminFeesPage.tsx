import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type FeesOverview, type StylistList } from './admin-api';
import { dayInZone, formatCount, formatDate, formatDateTime, formatFeeBps } from './admin-format';
import { Card, ErrorNote, Loading, PageHead, Pill } from './AdminPrimitives';
import { PUBLISH_TIME_ZONE, zonedWallTimeToInstant } from './blog/blog-model';

const todayInZone = () => dayInZone(new Date(), PUBLISH_TIME_ZONE);

/** Rates are typed as a percent (for example 1.5) and sent as basis points (150). The database allows 0 to 300 bps. */
function percentToBps(value: string): number | null {
  const number = Number(value);
  if (value.trim() === '' || !Number.isFinite(number)) return null;
  return Math.round(number * 100);
}

export default function AdminFeesPage() {
  const queryClient = useQueryClient();
  const fees = useQuery({ queryKey: ['admin', 'fees'], queryFn: () => adminRpc<FeesOverview>('mova_admin_fees_overview') });
  const [platformRate, setPlatformRate] = useState('');
  const [platformDate, setPlatformDate] = useState(todayInZone());
  const [platformReason, setPlatformReason] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [stylistRate, setStylistRate] = useState('');
  const [startsOn, setStartsOn] = useState(todayInZone());
  const [endsOn, setEndsOn] = useState('');
  const [stylistReason, setStylistReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [matches, setMatches] = useState<StylistList['stylists'] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'fees'] });
  }

  async function setPlatform(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bps = percentToBps(platformRate);
    const effective = zonedWallTimeToInstant(platformDate, '00:00', PUBLISH_TIME_ZONE);
    if (bps === null || !effective) { setError('Enter a rate and a date.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await adminRpc('mova_admin_set_platform_fee', { p_fee_bps: bps, p_effective_at: effective.toISOString(), p_reason: platformReason.trim() });
      setMessage(`Platform default set to ${formatFeeBps(bps)} from ${formatDate(effective.toISOString())}.`);
      setPlatformRate(''); setPlatformReason('');
      await refresh();
    } catch (err) { setError(adminErrorText(err)); } finally { setBusy(false); }
  }

  async function findStylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const result = await adminRpc<StylistList>('mova_admin_stylists', { p_filter: 'all', p_search: search.trim() || null, p_limit: 8, p_offset: 0 });
      setMatches(result.stylists);
    } catch (err) { setError(adminErrorText(err)); }
  }

  async function setStylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bps = percentToBps(stylistRate);
    if (!picked || bps === null) { setError('Pick a stylist and enter a rate.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await adminRpc('mova_admin_set_stylist_fee', {
        p_artist_business_id: picked.id, p_fee_bps: bps, p_starts_on: startsOn, p_ends_on: endsOn || null,
        p_reason: stylistReason.trim(), p_notify_stylist: notify,
      });
      setMessage(`${picked.name} now pays ${formatFeeBps(bps)}${endsOn ? ` until ${endsOn}` : ''}.`);
      setStylistRate(''); setStylistReason(''); setEndsOn('');
      await refresh();
    } catch (err) { setError(adminErrorText(err)); } finally { setBusy(false); }
  }

  if (fees.isPending) return <Loading />;
  if (fees.isError || !fees.data) return <ErrorNote message={adminErrorText(fees.error)} />;
  const d = fees.data;

  return (
    <>
      <PageHead title="Fees" sub="Mova's fee on each payment. Stylists pay their plan rate unless a custom rate applies." />
      <ErrorNote message={error} />
      {message ? <p className="notice" role="status">{message}</p> : null}
      <div className="cols2">
        <Card title="Platform default">
          <p className="big">{d.platform ? formatFeeBps(d.platform.fee_bps) : '—'}</p>
          <p className="small muted">{d.platform ? `In effect since ${formatDate(d.platform.effective_at)} (version ${d.platform.version}).` : 'No platform default set.'}</p>
          <p className="small muted">{formatCount(d.stylists_on_override)} of {formatCount(d.stylists_total)} stylists have a custom rate.</p>
          <ul className="list small">{d.plans.map((p) => <li key={p.plan_key}>{p.display_name}: {formatFeeBps(p.fee_bps)}</li>)}</ul>
          <form className="stack" onSubmit={(event) => void setPlatform(event)}>
            <div className="row">
              <label className="field"><span className="lbl">New default (%)</span><input className="input" inputMode="decimal" value={platformRate} onChange={(e) => setPlatformRate(e.target.value)} required /></label>
              <label className="field"><span className="lbl">Effective (Eastern)</span><input className="input" type="date" value={platformDate} min={todayInZone()} onChange={(e) => setPlatformDate(e.target.value)} required /></label>
            </div>
            <label className="field"><span className="lbl">Reason</span><input className="input" value={platformReason} onChange={(e) => setPlatformReason(e.target.value)} minLength={5} maxLength={500} required /></label>
            <button type="submit" className="btn pri" disabled={busy}>Set platform default</button>
          </form>
        </Card>
        <Card title="Custom rate for one stylist">
          <form className="row" onSubmit={(event) => void findStylist(event)}>
            <input className="input" aria-label="Find stylist" placeholder="Find a stylist" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button type="submit" className="btn sm ghost">Find</button>
          </form>
          {matches ? (
            <ul className="list">
              {matches.map((s) => (
                <li key={s.id}><button type="button" className={`btn sm ${picked?.id === s.id ? 'pri' : 'ghost'}`} onClick={() => setPicked({ id: s.id, name: s.name })}>{s.name} · B{s.bid}</button> <span className="small muted">{s.plan_name}, {formatFeeBps(s.fee_bps)}</span></li>
              ))}
            </ul>
          ) : null}
          {picked ? (
            <form className="stack" onSubmit={(event) => void setStylist(event)}>
              <p className="small">Setting a rate for <strong>{picked.name}</strong>.</p>
              <div className="row">
                <label className="field"><span className="lbl">Rate (%)</span><input className="input" inputMode="decimal" value={stylistRate} onChange={(e) => setStylistRate(e.target.value)} required /></label>
                <label className="field"><span className="lbl">Starts</span><input className="input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required /></label>
                <label className="field"><span className="lbl">Ends (optional)</span><input className="input" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></label>
              </div>
              <label className="field"><span className="lbl">Reason</span><input className="input" value={stylistReason} onChange={(e) => setStylistReason(e.target.value)} minLength={5} maxLength={500} required /></label>
              <label className="row small"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Tell the stylist</label>
              <button type="submit" className="btn pri" disabled={busy}>Save custom rate</button>
            </form>
          ) : null}
        </Card>
      </div>
      <Card title="Custom rates">
        {d.overrides.length === 0 ? <p className="muted">No custom rates.</p> : (
          <table className="tbl"><thead><tr className="th"><th>Stylist</th><th>Rate</th><th>Dates</th><th>Reason</th><th>Status</th></tr></thead><tbody>
            {d.overrides.map((o) => (
              <tr key={o.id} className="tr"><td>{o.name} <span className="small muted">B{o.bid}</span></td><td className="mono">{formatFeeBps(o.fee_bps)}</td>
                <td className="small">{formatDate(o.starts_at)}{o.ends_at ? ` to ${formatDate(o.ends_at)}` : ' onward'}</td><td className="small">{o.reason}</td>
                <td><Pill tone={o.status === 'active' ? 'ok' : o.status === 'scheduled' ? 'new' : 'off'}>{o.status}</Pill></td></tr>
            ))}
          </tbody></table>
        )}
      </Card>
      <Card title="History">
        {d.history.length === 0 ? <p className="muted">No changes yet.</p> : (
          <ul className="list small">{d.history.map((h, i) => (
            <li key={`${h.occurred_at}-${i}`}>{formatDateTime(h.occurred_at)} · {h.admin_name} · {h.action.replace(/\./g, ' ')}{h.business_name ? ` · ${h.business_name}` : ''}{h.reason ? ` · ${h.reason}` : ''}</li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}
