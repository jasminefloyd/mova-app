import { useEffect, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Sheet } from '../../components';
import { previousPath } from '../../app/RouteTrail';
import { appVersion, publicEnv } from '../../lib/env';
import { useArtistBusiness } from './useArtistBusiness';

export type FeedbackType = 'idea' | 'broken' | 'question';
const TYPES: FeedbackType[] = ['idea', 'broken', 'question'];
const SCREENSHOT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SCREENSHOT_MAX = 5 * 1024 * 1024;

/** Task 3.5 (canvas 16e): a quiet way for stylists to reach the Mova team. Never attaches client data. */
export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { client, businessId } = useArtistBusiness();
  const [type, setType] = useState<FeedbackType>('broken');
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [fileError, setFileError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'failed' | 'limited' | null>(null);
  const [sentTo, setSentTo] = useState<string | null | undefined>(undefined);

  useEffect(() => { if (open) { setType('broken'); setMessage(''); setScreenshot(null); setFileError(false); setError(null); setSentTo(undefined); } }, [open]);

  const call = async (body: Record<string, unknown>) => {
    if (!client) throw new Error('NO_CLIENT');
    const { data: { session } } = await client.auth.getSession();
    const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/support-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, 'x-mova-artist-business-id': businessId ?? '' },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (response.status === 429) throw new Error('LIMITED');
    if (!response.ok || !json?.data) throw new Error('FAILED');
    return json.data as Record<string, unknown>;
  };

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    const bad = Boolean(file && (!SCREENSHOT_TYPES.includes(file.type) || file.size > SCREENSHOT_MAX));
    setFileError(bad);
    setScreenshot(bad ? null : file);
  };

  const send = async () => {
    if (!client || !message.trim()) return;
    setBusy(true); setError(null);
    try {
      let screenshotPath: string | null = null;
      if (screenshot) {
        const target = await call({ action: 'upload-url', content_type: screenshot.type, size: screenshot.size });
        if (typeof target.path !== 'string' || typeof target.token !== 'string' || target.bucket !== 'mova_support_screenshots') throw new Error('FAILED');
        const { error: uploadError } = await client.storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, screenshot, { contentType: screenshot.type });
        if (uploadError) throw new Error('FAILED');
        screenshotPath = target.path;
      }
      const result = await call({
        action: 'submit', type, message: message.trim(), screenshot_path: screenshotPath,
        screen: previousPath() ?? window.location.pathname, app_version: appVersion, locale: i18n.language === 'es-US' ? 'es-US' : 'en-US',
      });
      setSentTo(typeof result.reply_to === 'string' ? result.reply_to : null);
    } catch (caught) {
      setError(caught instanceof Error && caught.message === 'LIMITED' ? 'limited' : 'failed');
    } finally { setBusy(false); }
  };

  const sent = sentTo !== undefined;
  return <Sheet open={open} title={sent ? t('feedback.sentTitle') : t('feedback.title')} closeLabel={t('feedback.close')} onClose={onClose}>
    {sent ? <div className="mova-feedback mova-feedback--sent">
      <p role="status">{sentTo ? t('feedback.thanksEmail', { email: sentTo }) : t('feedback.thanks')}</p>
      <Button type="button" onClick={onClose}>{t('feedback.done')}</Button>
    </div> : <form className="mova-feedback" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <p className="mova-feedback__intro">{t('feedback.intro')}</p>
      <fieldset className="mova-feedback__types">
        <legend>{t('feedback.typeLabel')}</legend>
        <div role="radiogroup" aria-label={t('feedback.typeLabel')}>{TYPES.map((value) => <button key={value} type="button" role="radio" aria-checked={type === value} className={type === value ? 'is-selected' : ''} onClick={() => setType(value)}>{t(`feedback.types.${value}`)}</button>)}</div>
      </fieldset>
      <label className="mova-field">
        <span className="mova-field__label">{t(`feedback.prompts.${type}`)}</span>
        <textarea className="mova-input mova-textarea" rows={5} maxLength={4000} required placeholder={t(`feedback.placeholders.${type}`)} value={message} onChange={(event) => setMessage(event.currentTarget.value)} />
      </label>
      <label className="mova-button mova-button--secondary mova-feedback__screenshot">
        {screenshot ? t('feedback.screenshotAdded', { name: screenshot.name }) : t('feedback.addScreenshot')}
        <input type="file" accept={SCREENSHOT_TYPES.join(',')} onChange={pick} />
      </label>
      {fileError && <p role="alert">{t('feedback.screenshotInvalid')}</p>}
      <p className="mova-feedback__note">{t('feedback.attachedNote')}</p>
      {error && <p role="alert">{t(error === 'limited' ? 'feedback.limited' : 'feedback.failed')}</p>}
      <Button type="submit" loading={busy} disabled={!message.trim()}>{t('feedback.send')}</Button>
    </form>}
  </Sheet>;
}
