import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../../components';
import { usePushDevice } from '../../pwa/usePushDevice';
import type { createMovaSupabaseClient } from '../../lib/supabase';

const SEEN_KEY = 'mova_push_prompt_seen';
type Client = ReturnType<typeof createMovaSupabaseClient>;

/**
 * P8: asks once, right after the first booking request shows up on Home, before the browser's own prompt.
 * Only where push can work now (not iPhone Safari, not blocked, not already on).
 */
export function PushPromptSheet({ client, businessId, hasBookingRequest }: { client: Client | null; businessId: string | null | undefined; hasBookingRequest: boolean }) {
  const { t } = useTranslation();
  const { state, busy, enable } = usePushDevice(client, businessId);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!hasBookingRequest || state !== 'off') return;
    try {
      if (Notification.permission !== 'default' || window.localStorage.getItem(SEEN_KEY)) return;
    } catch { return; }
    setOpen(true);
  }, [hasBookingRequest, state]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => {
    try { window.localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* optional */ }
    setOpen(false);
  };
  const turnOn = async () => { await enable(); close(); };

  if (!open) return null;
  return <dialog ref={dialogRef} className="mova-sheet mova-push-prompt" aria-modal="true" aria-labelledby="mova-push-prompt-h" onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="mova-sheet__panel">
      <div className="mova-sheet__handle" aria-hidden="true"><span /></div>
      <div className="mova-push-prompt__body">
        <span className="mova-push-prompt__icon" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg></span>
        <h2 id="mova-push-prompt-h">{t('pushPrompt.title')}</h2>
        <p>{t('pushPrompt.body')}</p>
        <ul>
          {(['bullet1', 'bullet2', 'bullet3'] as const).map((key) => <li key={key}><Icon name="check" size={16} />{t(`pushPrompt.${key}`)}</li>)}
        </ul>
        <Button loading={busy} onClick={() => void turnOn()}>{t('pushPrompt.turnOn')}</Button>
        <button type="button" className="mova-push-prompt__later" onClick={close}>{t('pushPrompt.notNow')}</button>
        <small>{t('pushPrompt.settingsNote')}</small>
      </div>
    </div>
  </dialog>;
}
