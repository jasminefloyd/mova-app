import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components';
import { publicEnv } from '../../lib/env';

type Line = { from: 'client' | 'assistant'; text: string };
const threadKey = (handle: string) => `mova_web_chat_thread:${handle}`;

function threadId(handle: string) {
  try {
    const saved = window.sessionStorage.getItem(threadKey(handle));
    if (saved) return saved;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(threadKey(handle), created);
    return created;
  } catch { return crypto.randomUUID(); }
}

/** Task 5.4: web chat with the stylist's booking assistant on their public page (flag, default off). */
export function WebChat({ artistHandle, stylistName }: { artistHandle: string; stylistName: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const first = stylistName.split(/\s+/)[0] ?? stylistName;
  useEffect(() => { log.current?.scrollTo?.({ top: log.current.scrollHeight }); }, [lines]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true); setError(false); setMessage('');
    setLines((old) => [...old, { from: 'client', text }]);
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/concierge-web-chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist_handle: artistHandle, thread_id: threadId(artistHandle), message: text, locale: i18n.resolvedLanguage === 'es-US' ? 'es-US' : 'en-US' }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || typeof json?.data?.reply !== 'string') throw new Error('CHAT_FAILED');
      setLines((old) => [...old, { from: 'assistant', text: json.data.reply }]);
    } catch { setError(true); } finally { setBusy(false); }
  };

  if (!open) return <div className="mova-web-chat__launch"><Button type="button" variant="secondary" onClick={() => setOpen(true)}>{t('concierge.chat.open', { name: first })}</Button></div>;
  return <section className="mova-web-chat" aria-label={t('concierge.chat.title', { name: first })}>
    <header className="mova-web-chat__head">
      <span><strong>{stylistName}</strong><small>{t('concierge.chat.subtitle', { name: first })}</small></span>
      <button type="button" className="mova-web-chat__close" onClick={() => setOpen(false)}>{t('concierge.chat.close')}</button>
    </header>
    <div className="mova-web-chat__log" role="log" aria-live="polite" aria-label={t('concierge.chat.messages')} ref={log}>
      <p className="mova-web-chat__intro">{t('concierge.chat.intro', { name: first })}</p>
      {lines.map((line, index) => line.from === 'client'
        ? <div key={index} className="mova-web-chat__bubble is-client">{line.text}</div>
        : <div key={index} className="mova-web-chat__assistant"><span>{t('concierge.chat.assistant', { name: first })}</span><div className="mova-web-chat__bubble">{line.text}</div></div>)}
      {busy && <div className="mova-web-chat__assistant" role="status"><span>{t('concierge.chat.assistant', { name: first })}</span><div className="mova-web-chat__bubble is-typing">{t('concierge.chat.typing')}</div></div>}
    </div>
    {error && <p role="alert" className="mova-web-chat__error">{t('concierge.chatUnavailable')}</p>}
    <form className="mova-web-chat__form" onSubmit={(event) => void send(event)}>
      <input aria-label={t('concierge.chat.placeholder')} placeholder={t('concierge.chat.placeholder')} value={message} maxLength={1000} onChange={(event) => setMessage(event.currentTarget.value)} />
      <Button type="submit" disabled={busy || !message.trim()}>{t('concierge.send')}</Button>
    </form>
  </section>;
}
