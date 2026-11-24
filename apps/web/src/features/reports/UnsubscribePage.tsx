import { useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components';
import { publicEnv } from '../../lib/env';

/** RV-D1: the "Stop review emails" link in a review-reply email. Nothing changes until the client confirms. */
export function UnsubscribePage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'invalid' | 'error'>('ask');
  const [name, setName] = useState('');
  const confirm = async () => {
    setState('busy');
    try {
      const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/email-unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '' }, body: JSON.stringify({ token }) });
      const envelope = await response.json().catch(() => ({}));
      if (response.status === 404) { setState('invalid'); return; }
      if (!response.ok) throw new Error();
      setName(String(envelope?.data?.business_name ?? ''));
      setState('done');
    } catch { setState('error'); }
  };
  return <main className="mova-page mova-public-review mova-unsubscribe">
    <header className="mova-public-review__brand"><p className="mova-wordmark">mova</p></header>
    {state === 'done'
      ? <section className="mova-review-thanks"><h1>{t('reviews.unsubscribe.doneTitle')}</h1><p>{name ? t('reviews.unsubscribe.doneBody', { name }) : t('reviews.unsubscribe.doneBodyNoName')}</p></section>
      : state === 'invalid'
        ? <div role="alert" className="mova-review-invalid"><strong>{t('reviews.unsubscribe.invalidTitle')}</strong><p>{t('reviews.unsubscribe.invalidBody')}</p></div>
        : <section className="mova-review-thanks"><h1>{t('reviews.unsubscribe.title')}</h1><p>{t('reviews.unsubscribe.body')}</p>
          {state === 'error' && <p role="alert">{t('reviews.unsubscribe.error')}</p>}
          <Button loading={state === 'busy'} onClick={() => void confirm()}>{t('reviews.unsubscribe.confirm')}</Button></section>}
  </main>;
}
export default UnsubscribePage;
