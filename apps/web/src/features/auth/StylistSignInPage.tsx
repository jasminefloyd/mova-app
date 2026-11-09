import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LocaleSwitcher } from '../../app/LocaleSwitcher';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { goTo, openWorkspace, resolveWorkspaces, type WorkspaceChoice } from './stylist-workspace';
import './stylist-auth.css';

/** W9 · /login: stylist sign-in (existing accounts). Client sign-in lives at /signin. */
export default function StylistSignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') ?? '';
  const supabase = useMemo(() => { try { return createMovaSupabaseClient(); } catch { return null; } }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState<WorkspaceChoice[]>([]);

  const enterWorkspace = async (businessId: string) => {
    if (!supabase) return;
    goTo(await openWorkspace(supabase, businessId, returnTo), navigate);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!supabase) { setError(t('stylistAuth.configurationError')); return; }
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) { setError(t('stylistAuth.signIn.error')); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError(t('stylistAuth.signIn.error')); return; }
      const resolution = await resolveWorkspaces(supabase, session.user.id, returnTo);
      if (resolution.kind === 'one') await enterWorkspace(resolution.businessId);
      else if (resolution.kind === 'choose') setChoices(resolution.choices);
      else navigate('/onboarding/profile', { replace: true });
    } catch {
      setError(t('stylistAuth.accountError'));
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
        <div className="stylist-auth__field">
          <div className="stylist-auth__label-row">
            <label htmlFor="stylist-signin-password">{t('stylistAuth.signIn.password')}</label>
            <Link className="stylist-auth__muted-link" to={`/reset-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}>{t('stylistAuth.signIn.forgot')}</Link>
          </div>
          <input id="stylist-signin-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
        </div>
        {error && <p className="stylist-auth__error" role="alert">{error}</p>}
        <button className="stylist-auth__submit" type="submit" disabled={busy}>{t(busy ? 'stylistAuth.signIn.submitting' : 'stylistAuth.signIn.submit')}</button>
      </form>

      {choices.length > 0 && <section className="stylist-auth__choices" aria-label={t('stylistAuth.signIn.chooseTitle')}>
        <h2>{t('stylistAuth.signIn.chooseTitle')}</h2>
        {choices.map((choice) => <button key={choice.id} type="button" className="stylist-auth__choice" onClick={() => void enterWorkspace(choice.id)}>{choice.label}</button>)}
      </section>}

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
