import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, TextArea } from '../../components';

const reasons = ['cost', 'features', 'switching', 'no_longer_needed', 'other'] as const;

export default function AccountClosurePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  const reactivate = params.get('mode') === 'reactivate';
  const ended = params.get('ended') === '1';
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'ready' | 'busy' | 'done' | 'error'>('ready');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === 'busy') return;
    setState('busy');
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/privacy-management`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: reactivate ? 'reactivate' : 'feedback', token, reason, comment }),
      });
      if (!response.ok) throw new Error('CLOSURE_LINK_FAILED');
      setState('done');
    } catch { setState('error'); }
  };

  return <main className="mova-page mova-privacy-page">
    <h1>{t(reactivate ? 'accountClosure.reactivate' : ended ? 'accountClosure.ended' : 'accountClosure.feedback')}</h1>
    <Card className="mova-privacy-card">
      {ended ? <p>{t('accountClosure.endedDetail')}</p> : state === 'done' ? <>
        <p role="status">{t(reactivate ? 'accountClosure.restored' : 'accountClosure.thanks')}</p>
        {reactivate && <Link to="/login">{t('accountClosure.signIn')}</Link>}
      </> : <form className="mova-privacy-card" onSubmit={submit}>
        {reactivate ? <p>{t('accountClosure.reactivateDetail')}</p> : <>
          <p>{t('accountClosure.feedbackDetail')}</p>
          <label className="mova-field">
            <span className="mova-field__label">{t('accountClosure.reason')}</span>
            <select className="mova-input" value={reason} onChange={event => setReason(event.target.value)}>
              <option value="">{t('accountClosure.choose')}</option>
              {reasons.map(value => <option key={value} value={value}>{t(`accountClosure.reasons.${value}`)}</option>)}
            </select>
          </label>
          <TextArea label={t('accountClosure.comment')} maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} />
        </>}
        {state === 'error' && <p role="alert">{t('accountClosure.unavailable')}</p>}
        <Button type="submit" loading={state === 'busy'} disabled={!reactivate && !reason && !comment.trim()}>
          {t(reactivate ? 'accountClosure.reactivate' : 'accountClosure.send')}
        </Button>
      </form>}
    </Card>
  </main>;
}
