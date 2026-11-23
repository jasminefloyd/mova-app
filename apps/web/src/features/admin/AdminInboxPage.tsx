import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type SupportList, type SupportMessage } from './admin-api';
import { formatDateTime } from './admin-format';
import { Empty, ErrorNote, Loading, PageHead, Pill, Segmented, type PillTone } from './AdminPrimitives';

type Status = 'all' | 'new' | 'in_progress' | 'waiting_on_stylist' | 'resolved';
const statusLabel: Record<SupportMessage['status'], string> = { new: 'New', in_progress: 'In progress', waiting_on_stylist: 'Waiting on stylist', resolved: 'Resolved' };
const statusTone: Record<SupportMessage['status'], PillTone> = { new: 'new', in_progress: 'warn', waiting_on_stylist: 'off', resolved: 'ok' };
const typeLabel: Record<SupportMessage['type'], string> = { idea: 'Idea', broken: 'Something broke', question: 'Question' };

export default function AdminInboxPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('new');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [reply, setReply] = useState('');
  const [closeAfterReply, setCloseAfterReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedId = params.get('message');

  const list = useQuery({
    queryKey: ['admin', 'inbox', status, submitted],
    queryFn: () => adminRpc<SupportList>('mova_admin_support_list', { p_status: status, p_search: submitted || null, p_limit: 50, p_before: null }),
  });
  const selected = list.data?.messages.find((m) => m.id === selectedId) ?? list.data?.messages[0] ?? null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'inbox'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'nav', 'inbox'] });
  }

  async function setMessageStatus(next: SupportMessage['status']) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await adminRpc('mova_admin_support_set_status', { p_message_id: selected.id, p_status: next });
      await refresh();
    } catch (err) {
      setError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await adminRpc('mova_admin_support_reply', { p_message_id: selected.id, p_body: reply.trim(), p_close: closeAfterReply });
      setReply('');
      setCloseAfterReply(false);
      await refresh();
    } catch (err) {
      setError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const options: { value: Status; label: string; count?: number | undefined }[] = [
    { value: 'new', label: 'New', count: list.data?.counts.new },
    { value: 'in_progress', label: 'In progress', count: list.data?.counts.in_progress },
    { value: 'waiting_on_stylist', label: 'Waiting', count: list.data?.counts.waiting_on_stylist },
    { value: 'resolved', label: 'Resolved', count: list.data?.counts.resolved },
    { value: 'all', label: 'All', count: list.data?.counts.all },
  ];

  const preview = (text: string) => text.length > 90 ? `${text.slice(0, 88)}…` : text;
  return (
    <>
      <PageHead title="Support inbox" sub="Feedback stylists send from the app. Replies are saved here; email delivery is not connected yet."
        actions={<Segmented variant="chips" label="Status" value={status} onChange={(value) => { setStatus(value); setParams({}); }} options={options} />} />
      <ErrorNote message={list.isError ? adminErrorText(list.error) : null} />
      {list.isPending ? <Loading /> : null}
      {list.data ? (
        <div className="inbox">
          {/* A7: two panes — the list with its search on the left, the open message on the right. */}
          <div className="inbox-list">
            <form className="search-field inbox-search" role="search" onSubmit={(event) => { event.preventDefault(); setSubmitted(search.trim()); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input className="input" type="search" aria-label="Search messages" placeholder="Search messages" value={search} onChange={(event) => setSearch(event.target.value)} />
            </form>
            {list.data.messages.length === 0 ? <div style={{ padding: 16 }}><Empty>No messages in this view.</Empty></div> : (
              <ul aria-label="Messages">
                {list.data.messages.map((m) => (
                  <li key={m.id}>
                    <button type="button" className={`inbox-item${selected?.id === m.id ? ' on' : ''}`} aria-current={selected?.id === m.id} onClick={() => setParams({ message: m.id })}>
                      <span className="inbox-item__top"><strong>{m.stylist_name}</strong><span className="small muted">{formatDateTime(m.created_at)}</span></span>
                      <span className="small"><strong>{typeLabel[m.type]}</strong> · {preview(m.message)}</span>
                      <Pill tone={statusTone[m.status]}>{statusLabel[m.status]}</Pill>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selected ? (
            <section className="card inbox-detail" aria-labelledby="inbox-detail-title">
              <div className="inbox-detail__head">
                <div><h2 className="h2" id="inbox-detail-title">{preview(selected.message.split('\n')[0] ?? selected.message)}</h2>
                  <p className="small muted">{typeLabel[selected.type]} · from {selected.stylist_name} · {selected.business_name} · BID-{selected.bid} · {formatDateTime(selected.created_at)}</p></div>
                <label className="status-select"><span className="visually-hidden">Status</span>
                  <select className="select" value={selected.status} disabled={busy} onChange={(event) => void setMessageStatus(event.target.value as Exclude<Status, 'all'>)}>
                    {(['new', 'in_progress', 'waiting_on_stylist', 'resolved'] as const).map((next) => <option key={next} value={next}>Status: {statusLabel[next]}</option>)}
                  </select>
                </label>
              </div>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{selected.message}</p>
              <div className="meta-tiles">
                <div><span className="small muted">Screen</span><strong>{selected.screen ?? '—'}</strong></div>
                <div><span className="small muted">Device</span><strong>{selected.device ?? '—'}</strong></div>
                <div><span className="small muted">App version</span><strong>{selected.app_version ?? '—'}</strong></div>
                <div><span className="small muted">Language</span><strong>{selected.locale === 'es-US' ? 'Spanish' : 'English'}</strong></div>
              </div>
              {selected.has_screenshot ? <p className="small muted">Screenshot attached.</p> : null}
              {selected.replies.map((r) => (
                <div key={r.id} className="notice">
                  <div className="small muted">{r.admin_name} · {formatDateTime(r.created_at)} · {r.delivery === 'not_sent' ? 'Saved, not emailed (email not connected)' : r.delivery}</div>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{r.body}</p>
                </div>
              ))}
              <ErrorNote message={error} />
              <form className="stack" onSubmit={(event) => void sendReply(event)}>
                <label className="field">
                  <span className="lbl">Reply to {selected.stylist_name.split(/\s+/)[0]}</span>
                  <textarea className="input" rows={4} maxLength={4000} value={reply} placeholder="Write a reply. It's saved here and shows on this message." onChange={(event) => setReply(event.target.value)} required />
                </label>
                <div className="inbox-detail__actions">
                  <label className="row small"><input type="checkbox" checked={closeAfterReply} onChange={(event) => setCloseAfterReply(event.target.checked)} /> Mark resolved after replying</label>
                  <span className="row">
                    <button type="button" className="btn sm" disabled={busy || selected.status === 'resolved'} onClick={() => void setMessageStatus('resolved')}>Close without reply</button>
                    <button type="submit" className="btn pri sm" disabled={busy || reply.trim().length === 0}>{busy ? 'Saving…' : 'Save reply'}</button>
                  </span>
                </div>
              </form>
            </section>
          ) : <div className="card"><p className="muted">Choose a message to read it.</p></div>}
        </div>
      ) : null}
    </>
  );
}
