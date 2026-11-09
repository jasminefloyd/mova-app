import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LocaleSwitcher } from '../../app/LocaleSwitcher';
import { createMovaSupabaseClient } from '../../lib/supabase';
import './stylist-auth.css';

type RecoveryState = 'request' | 'sent' | 'recovery' | 'saved';

export default function StylistPasswordResetPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const supabase = useMemo(() => { try { return createMovaSupabaseClient(); } catch { return null; } }, []);
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<RecoveryState>('request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    let live = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (live && data.session && window.location.hash.includes('type=recovery')) setState('recovery');
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (live && event === 'PASSWORD_RECOVERY') setState('recovery');
    });
    return () => { live = false; listener.subscription.unsubscribe(); };
  }, [supabase]);

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    if (!supabase) { setError(t('stylistAuth.configurationError')); setBusy(false); return; }
    try {
      await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
      // Keep the response generic so the form does not disclose whether an account exists.
      setState('sent');
    } catch { setError(t('stylistAuth.passwordReset.requestError')); }
    finally { setBusy(false); }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    if (!supabase) { setError(t('stylistAuth.configurationError')); setBusy(false); return; }
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setState('saved');
      await supabase.auth.signOut();
    } catch { setError(t('stylistAuth.passwordReset.updateError')); }
    finally { setBusy(false); }
  }

  return <div className="stylist-auth stylist-auth--signin">
    <header className="stylist-auth__top"><Link className="stylist-auth__wordmark" to="/">mova</Link><div className="stylist-auth__locale"><LocaleSwitcher /></div></header>
    <div className="stylist-auth__rule" aria-hidden="true" />
    <div className="stylist-auth__column">
      <div className="stylist-auth__intro"><span className="stylist-auth__badge">{t('stylistAuth.passwordReset.badge')}</span><h1 className="stylist-auth__title">{t(state === 'recovery' ? 'stylistAuth.passwordReset.newTitle' : state === 'saved' ? 'stylistAuth.passwordReset.savedTitle' : 'stylistAuth.passwordReset.title')}</h1><p className="stylist-auth__lede">{t(state === 'sent' ? 'stylistAuth.passwordReset.sent' : state === 'saved' ? 'stylistAuth.passwordReset.saved' : state === 'recovery' ? 'stylistAuth.passwordReset.newIntro' : 'stylistAuth.passwordReset.intro')}</p></div>
      {state === 'request' && <form className="stylist-auth__form" onSubmit={(event) => void requestReset(event)}>
        <div className="stylist-auth__field"><label htmlFor="password-reset-email">{t('stylistAuth.signIn.email')}</label><input id="password-reset-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} /></div>
        {error && <p className="stylist-auth__error" role="alert">{error}</p>}
        <button className="stylist-auth__submit" type="submit" disabled={busy}>{t(busy ? 'stylistAuth.passwordReset.sending' : 'stylistAuth.passwordReset.send')}</button>
      </form>}
      {state === 'recovery' && <form className="stylist-auth__form" onSubmit={(event) => void savePassword(event)}>
        <div className="stylist-auth__field"><label htmlFor="new-password">{t('stylistAuth.passwordReset.newPassword')}</label><input id="new-password" type="password" autoComplete="new-password" minLength={9} required value={password} onChange={(event) => setPassword(event.currentTarget.value)} /></div>
        {error && <p className="stylist-auth__error" role="alert">{error}</p>}
        <button className="stylist-auth__submit" type="submit" disabled={busy || password.length < 9}>{t(busy ? 'stylistAuth.passwordReset.saving' : 'stylistAuth.passwordReset.save')}</button>
      </form>}
      {state === 'saved' ? <button className="stylist-auth__submit" type="button" onClick={() => navigate('/login', { replace: true })}>{t('stylistAuth.passwordReset.signIn')}</button> : null}
      {state === 'sent' ? <p className="stylist-auth__small"><Link className="stylist-auth__strong" to="/login">{t('stylistAuth.passwordReset.back')}</Link></p> : null}
      {state === 'request' && <div className="stylist-auth__aside"><p><Link className="stylist-auth__strong" to="/login">{t('stylistAuth.passwordReset.back')}</Link></p></div>}
    </div>
    <footer className="stylist-auth__footer"><span>{t('stylistAuth.legal.terms')}</span> · <span>{t('stylistAuth.legal.privacy')}</span> · <span>{t('stylistAuth.legal.help')}</span></footer>
  </div>;
}
