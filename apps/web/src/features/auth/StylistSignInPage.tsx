import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LocaleSwitcher } from '../../app/LocaleSwitcher';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { CheckEmailPanel } from './CheckEmailPanel';
import { sendStylistEmailLink } from './email-link';
import './stylist-auth.css';

/** W9 · /login: stylist sign-in (existing accounts) with a passwordless email link. The link lands on
 * /auth/confirm, which opens the right workspace. Client sign-in lives at /signin. */
export default function StylistSignInPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') ?? '';
  const supabase = useMemo(() => { try { return createMovaSupabaseClient(); } catch { return null; } }, []);
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!supabase) return false;
    return (await sendStylistEmailLink(supabase, { email, create: false, returnTo })).ok;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!supabase) { setError(t('stylistAuth.configurationError')); return; }
    setBusy(true);
    try {
      if (await send()) setSent(true);
      else setError(t('stylistAuth.signIn.error'));
    } catch {
      setError(t('stylistAuth.signIn.error'));
    } finally {
      setBusy(false);
    }
  };

  return <div className="stylist-auth stylist-auth--signin">
    <header className="stylist-auth__top">
      <Link className="stylist-auth__wordmark" to="/">mova</Link>
      <div className="stylist-auth__locale"><LocaleSwitcher /></div>
    </header>
    <div className="stylist-auth__rule" aria-hidden="true" />

    <div className="stylist-auth__column">
      {sent ? <CheckEmailPanel email={email.trim()} message={t('stylistAuth.checkEmail.signInSent', { email: email.trim() })} onResend={send} onChangeEmail={() => setSent(false)} /> : <>
      <div className="stylist-auth__intro">
        <span className="stylist-auth__badge">{t('stylistAuth.signIn.badge')}</span>
        <h1 className="stylist-auth__title">{t('stylistAuth.signIn.title')}</h1>
        <p className="stylist-auth__lede">{t('stylistAuth.signIn.intro')}</p>
      </div>

      <form className="stylist-auth__form" aria-label={t('stylistAuth.signIn.formLabel')} onSubmit={(event) => void submit(event)}>
        <div className="stylist-auth__field">
          <label htmlFor="stylist-signin-email">{t('stylistAuth.signIn.email')}</label>
          <input id="stylist-signin-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
        </div>
        {error && <p className="stylist-auth__error" role="alert">{error}</p>}
        <button className="stylist-auth__submit" type="submit" disabled={busy}>{t(busy ? 'stylistAuth.signIn.submitting' : 'stylistAuth.signIn.submit')}</button>
      </form>
      </>}

      <div className="stylist-auth__aside">
        <p>{t('stylistAuth.signIn.newToMova')} <Link className="stylist-auth__strong" to="/signup">{t('stylistAuth.signIn.createLink')}</Link></p>
        <p className="stylist-auth__small">{t('stylistAuth.signIn.clientPrompt')} <Link className="stylist-auth__strong" to="/signin">{t('stylistAuth.signIn.clientLink')}</Link> {t('stylistAuth.signIn.clientNote')}</p>
      </div>
    </div>

    <footer className="stylist-auth__footer">
      <span>{t('stylistAuth.legal.terms')}</span> · <span>{t('stylistAuth.legal.privacy')}</span> · <span>{t('stylistAuth.legal.help')}</span>
    </footer>
  </div>;
}
