import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminErrorText, adminRpc, type SupportList, type SupportMessage } from './admin-api';
import { formatCount, formatDateTime } from './admin-format';
import { Card, Empty, ErrorNote, Loading, PageHead, Pill, Segmented, type PillTone } from './AdminPrimitives';

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

  return (
    <>
      <PageHead title="Support inbox" sub="Messages from stylists. Replies are saved; email delivery is not connected yet, so each reply shows as not sent." />
      <div className="toolbar">
        <Segmented label="Status" value={status} onChange={(value) => { setStatus(value); setParams({}); }} options={options} />
        <form className="row" onSubmit={(event) => { event.preventDefault(); setSubmitted(search.trim()); }}>
          <input className="input" type="search" aria-label="Search messages" placeholder="Search messages" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button type="submit" className="btn sm ghost">Search</button>
        </form>
      </div>
      <ErrorNote message={list.isError ? adminErrorText(list.error) : null} />
      {list.isPending ? <Loading /> : null}
      {list.data && list.data.messages.length === 0 ? <Empty>No messages in this view.</Empty> : null}
      {list.data && list.data.messages.length > 0 ? (
        <div className="inbox">
          <ul className="inbox-list" aria-label="Messages">
            {list.data.messages.map((m) => (
              <li key={m.id}>
                <button type="button" className={`inbox-item${selected?.id === m.id ? ' on' : ''}`} aria-current={selected?.id === m.id} onClick={() => setParams({ message: m.id })}>
                  <span className="nm">{m.stylist_name} <span className="muted small">B{m.bid}</span></span>
                  <span className="small">{typeLabel[m.type]} · {formatDateTime(m.created_at)}</span>
                  <Pill tone={statusTone[m.status]}>{statusLabel[m.status]}</Pill>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <Card className="inbox-detail" title={`${typeLabel[selected.type]} from ${selected.stylist_name}`} aside={<span className="small muted">{formatCount(selected.replies.length)} replies</span>}>
              <dl className="kv">
                <dt>Business</dt><dd>{selected.business_name} · B{selected.bid}</dd>
                <dt>Screen</dt><dd>{selected.screen ?? '—'}</dd>
                <dt>Device</dt><dd>{selected.device ?? '—'}{selected.app_version ? ` · v${selected.app_version}` : ''}</dd>
                <dt>Language</dt><dd>{selected.locale === 'es-US' ? 'Spanish (US)' : 'English (US)'}</dd>
                <dt>Screenshot</dt><dd>{selected.has_screenshot ? 'Attached' : 'None'}</dd>
              </dl>
              <p className="pad0" style={{ whiteSpace: 'pre-wrap' }}>{selected.message}</p>
              {selected.replies.map((r) => (
                <div key={r.id} className="notice">
                  <div className="small muted">{r.admin_name} · {formatDateTime(r.created_at)} · {r.delivery === 'not_sent' ? 'Not sent (email not connected)' : r.delivery}</div>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{r.body}</p>
                </div>
              ))}
              <ErrorNote message={error} />
              <div className="row">
                {(['new', 'in_progress', 'waiting_on_stylist', 'resolved'] as const).map((next) => (
                  <button key={next} type="button" className={`btn sm ${selected.status === next ? 'pri' : 'ghost'}`} disabled={busy || selected.status === next} onClick={() => void setMessageStatus(next)}>
                    {statusLabel[next]}
                  </button>
                ))}
              </div>
              <form className="stack" onSubmit={(event) => void sendReply(event)}>
                <label className="field">
                  <span className="lbl">Reply to {selected.stylist_name}</span>
                  <textarea className="input" rows={4} maxLength={4000} value={reply} onChange={(event) => setReply(event.target.value)} required />
                </label>
                <label className="row small"><input type="checkbox" checked={closeAfterReply} onChange={(event) => setCloseAfterReply(event.target.checked)} /> Mark resolved after replying</label>
                <button type="submit" className="btn pri" disabled={busy || reply.trim().length === 0}>{busy ? 'Saving…' : 'Save reply'}</button>
              </form>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
