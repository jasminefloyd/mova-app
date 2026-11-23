import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type FeesOverview, type StylistList } from './admin-api';
import { dayInZone, formatCount, formatDate, formatFeeBps } from './admin-format';
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
  const [picked, setPicked] = useState<{ id: string; name: string; current: number | null; plan: string } | null>(null);
  const [searchParams] = useSearchParams();
  // Opened from a stylist's detail page (Change fee for …): start with the panel open.
  const [panel, setPanel] = useState(searchParams.has('stylist'));
  const [editDefault, setEditDefault] = useState(false);
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
      setPlatformRate(''); setPlatformReason(''); setEditDefault(false);
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
      setStylistRate(''); setStylistReason(''); setEndsOn(''); setPicked(null); setPanel(false); setMatches(null);
      await refresh();
    } catch (err) { setError(adminErrorText(err)); } finally { setBusy(false); }
  }

  if (fees.isPending) return <Loading />;
  if (fees.isError || !fees.data) return <ErrorNote message={adminErrorText(fees.error)} />;
  const d = fees.data;

  const historyText = (h: FeesOverview['history'][number]) => {
    const bps = typeof (h.details as { fee_bps?: unknown } | null)?.fee_bps === 'number' ? (h.details as { fee_bps: number }).fee_bps : null;
    const who = h.business_name ?? 'Platform default';
    return h.action === 'fee.platform_default_set' ? `Platform default set to ${bps !== null ? formatFeeBps(bps) : 'a new rate'}` : `${who}${bps !== null ? ` → ${formatFeeBps(bps)}` : ''}`;
  };
  const panelOpen = picked !== null || matches !== null || panel;
  return (
    <>
      <PageHead title="Transaction fees" sub="The Mova fee on card payments processed through Stripe. Payments stylists record themselves and salon-collected payments never have a fee."
        actions={<button type="button" className="btn pri sm" onClick={() => { setPanel(true); setMatches(null); setPicked(null); }}>+ Set a stylist rate</button>} />
      <ErrorNote message={error} />
      {message ? <p className="notice" role="status">{message}</p> : null}
      <div className={panelOpen ? 'fee-layout' : ''}>
        <div className="stack">
          {/* A6: the default leads as a headline; changing it opens the form in place. */}
          <Card>
            <div className="fee-default">
              <div><span className="small muted">Platform default</span><p className="fee-default__value">{d.platform ? formatFeeBps(d.platform.fee_bps) : '—'}</p>
                <p className="small muted">{d.platform ? `Since ${formatDate(d.platform.effective_at)} · applies to ${formatCount(d.stylists_total - d.stylists_on_override)} of ${formatCount(d.stylists_total)} stylists` : 'No platform default set.'}</p>
                <p className="small muted">Plan rates: {d.plans.map((p) => `${p.display_name} ${formatFeeBps(p.fee_bps)}`).join(' · ')}</p></div>
              {!editDefault ? <button type="button" className="btn sm" onClick={() => setEditDefault(true)}>Change default</button> : null}
            </div>
            {editDefault ? <form className="stack" onSubmit={(event) => void setPlatform(event)}>
              <div className="row">
                <label className="field"><span className="lbl">New default (%)</span><input className="input" inputMode="decimal" value={platformRate} onChange={(e) => setPlatformRate(e.target.value)} required /></label>
                <label className="field"><span className="lbl">Effective (Eastern)</span><input className="input" type="date" value={platformDate} min={todayInZone()} onChange={(e) => setPlatformDate(e.target.value)} required /></label>
              </div>
              <label className="field"><span className="lbl">Reason</span><input className="input" value={platformReason} onChange={(e) => setPlatformReason(e.target.value)} minLength={5} maxLength={500} required /></label>
              <div className="row"><button type="button" className="btn sm" onClick={() => setEditDefault(false)}>Cancel</button><button type="submit" className="btn pri sm" disabled={busy}>Set platform default</button></div>
            </form> : null}
          </Card>
          <p className="info-banner" role="note">A new rate only applies to payments created on or after its start date. Past payments keep the rate they were charged, and each payment stores its rate so Money stays correct.</p>
          <Card title="Stylist rates" aside={<span className="small muted">{formatCount(d.stylists_on_override)} stylists not on the default</span>} className="pad0">
            {d.overrides.length === 0 ? <p className="muted" style={{ padding: 16 }}>No custom rates.</p> : (
              <div className="tbl-wrap flat"><table className="tbl"><thead><tr className="th"><th>Stylist</th><th>Rate</th><th>When</th><th>Reason</th><th>Status</th></tr></thead><tbody>
                {d.overrides.map((o) => (
                  <tr key={o.id} className="tr"><td><strong>{o.name}</strong><div className="small muted">{o.business_name} · BID-{o.bid}</div></td><td><strong>{formatFeeBps(o.fee_bps)}</strong></td>
                    <td className="small">{o.status === 'scheduled' ? 'From' : 'Since'} {formatDate(o.starts_at)}{o.ends_at ? ` – ${formatDate(o.ends_at)}` : ''}</td><td className="small">{o.reason}</td>
                    <td><Pill tone={o.status === 'active' ? 'ok' : o.status === 'scheduled' ? 'warn' : 'off'}>{o.status.charAt(0).toUpperCase() + o.status.slice(1)}</Pill></td></tr>
                ))}
              </tbody></table></div>
            )}
          </Card>
          <Card title="Change history">
            {d.history.length === 0 ? <p className="muted">No changes yet.</p> : (
              <ul className="activity-list">{d.history.map((h, i) => (
                <li key={`${h.occurred_at}-${i}`}><span className="small muted">{formatDate(h.occurred_at)}</span><span>{historyText(h)}<br /><span className="small muted">by {h.admin_name}{h.reason ? ` · ${h.reason}` : ''}</span></span><span /></li>
              ))}</ul>
            )}
          </Card>
        </div>
        {panelOpen ? <aside className="card fee-panel" aria-labelledby="fee-panel-title">
          <div className="card-h"><h2 className="h2" id="fee-panel-title">Set a stylist rate</h2><button type="button" className="btn sm" aria-label="Close" onClick={() => { setPanel(false); setPicked(null); setMatches(null); }}>×</button></div>
          {!picked ? <>
            <form className="search-field" role="search" onSubmit={(event) => void findStylist(event)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input className="input" aria-label="Find stylist" placeholder="Name, business or BID" value={search} onChange={(e) => setSearch(e.target.value)} />
            </form>
            {matches ? <ul className="activity-list">{matches.map((s) => (
              <li key={s.id}><span><button type="button" className="btn link" onClick={() => setPicked({ id: s.id, name: s.name, current: s.fee_bps, plan: s.plan_name })}><strong>{s.name}</strong></button><br /><span className="small muted">{s.business_name} · BID-{s.bid}</span></span><span className="small muted">{s.plan_name}, {formatFeeBps(s.fee_bps)}</span></li>
            ))}</ul> : <p className="small muted">Search for the stylist, then set the rate and dates.</p>}
          </> : (
            <form className="stack" onSubmit={(event) => void setStylist(event)}>
              <div className="field"><span className="lbl">Stylist</span><div className="picked"><strong>{picked.name}</strong><button type="button" className="btn link small" onClick={() => setPicked(null)}>Change</button></div>
                <span className="small muted">Current rate: {formatFeeBps(picked.current)} ({picked.current === null ? 'plan rate' : 'custom'})</span></div>
              <label className="field"><span className="lbl">New rate (%)</span><input className="input" inputMode="decimal" value={stylistRate} onChange={(e) => setStylistRate(e.target.value)} required /></label>
              <label className="field"><span className="lbl">Starts</span><input className="input" type="date" value={startsOn} min={todayInZone()} onChange={(e) => setStartsOn(e.target.value)} required /><span className="small muted">Must be today or later.</span></label>
              <label className="field"><span className="lbl">Ends (optional)</span><input className="input" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></label>
              <label className="field"><span className="lbl">Reason</span><textarea className="input" rows={2} value={stylistReason} onChange={(e) => setStylistReason(e.target.value)} minLength={5} maxLength={500} required /></label>
              <label className="row small"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> <span><strong>Email {picked.name.split(/\s+/)[0]} about this change</strong><br /><span className="muted">Sent today, with the new rate and start date.</span></span></label>
              {percentToBps(stylistRate) !== null ? <p className="info-banner small">Card payments {picked.name.split(/\s+/)[0]} creates on or after <strong>{formatDate(`${startsOn}T12:00:00Z`)}</strong> will use <strong>{formatFeeBps(percentToBps(stylistRate))}</strong>. Payments before then keep {formatFeeBps(picked.current)}.</p> : null}
              <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn sm" onClick={() => setPicked(null)}>Cancel</button><button type="submit" className="btn pri sm" disabled={busy}>Schedule change</button></div>
            </form>
          )}
        </aside> : null}
      </div>
    </>
  );
}
