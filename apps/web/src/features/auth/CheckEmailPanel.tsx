import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const RESEND_SECONDS = 60;

/** "Check your email" state shown after a passwordless sign-up or sign-in link is requested. */
export function CheckEmailPanel({ email, message, onResend, onChangeEmail }: {
  email: string;
  message?: string;
  onResend: () => Promise<boolean>;
  onChangeEmail: () => void;
}) {
  const { t } = useTranslation();
  const [wait, setWait] = useState(RESEND_SECONDS);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const resend = async () => {
    setBusy(true); setResent(false); setFailed(false);
    const ok = await onResend();
    setBusy(false);
    if (ok) { setResent(true); setWait(RESEND_SECONDS); } else setFailed(true);
  };

  return <section className="stylist-auth__check" aria-labelledby="stylist-auth-check-h">
    <span className="stylist-auth__check-icon" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></svg>
    </span>
    <h1 id="stylist-auth-check-h" className="stylist-auth__title">{t('stylistAuth.checkEmail.title')}</h1>
    <p className="stylist-auth__lede">{message ?? t('stylistAuth.checkEmail.body', { email })}</p>
    <p className="stylist-auth__hint">{t('stylistAuth.checkEmail.once')} {t('stylistAuth.checkEmail.spam')}</p>
    {resent && <p className="stylist-auth__notice" role="status">{t('stylistAuth.checkEmail.resent')}</p>}
    {failed && <p className="stylist-auth__error" role="alert">{t('stylistAuth.signIn.error')}</p>}
    <button type="button" className="stylist-auth__secondary" disabled={busy || wait > 0} onClick={() => void resend()}>
      {wait > 0 ? t('stylistAuth.checkEmail.resendIn', { seconds: wait }) : t('stylistAuth.checkEmail.resend')}
    </button>
    <button type="button" className="stylist-auth__text-button" onClick={onChangeEmail}>{t('stylistAuth.checkEmail.different')}</button>
  </section>;
}
