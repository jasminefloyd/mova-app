import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { createMovaSupabaseClient } from '../../lib/supabase';
import type { ReactNode } from 'react';
import { CheckEmailPanel } from './CheckEmailPanel';
import { sendStylistEmailCode } from './email-code';
import { trialMarketingEnabled } from '../../lib/env';
import './stylist-auth.css';

function FeatureIcon({ children }: { children: ReactNode }) {
  return <span className="stylist-auth__feature-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--mint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg></span>;
}

/** W8 · /signup: stylist sign-up (onboarding step 1). Passwordless: first name, last name and email,
 * then a one-time email code verifies the address and signs the stylist in. No invite or waitlist step. */
export default function StylistSignUpPage() {
  const { t } = useTranslation();
  const supabase = useMemo(() => { try { return createMovaSupabaseClient(); } catch { return null; } }, []);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  // "Start free" in the pitch scrolls down to the form and puts the cursor in First name.
  const startFree = () => {
    document.getElementById('stylist-signup-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => document.getElementById('stylist-signup-first')?.focus({ preventScroll: true }), 350);
  };

  const verify = async (code: string) => {
    if (!supabase) return false;
    const { error: verifyError } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
    if (verifyError) return false;
    navigate('/auth/confirm?returnTo=%2Fonboarding%2Fprofile', { replace: true });
    return true;
  };

  const send = async () => {
    if (!supabase) return false;
    const result = await sendStylistEmailCode(supabase, { email, create: true, firstName, lastName, locale: 'en-US' });
    return result.ok;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!supabase) { setError(t('stylistAuth.configurationError')); return; }
    if (!firstName.trim() || !lastName.trim()) { setError(t('stylistAuth.signUp.nameRequired')); return; }
    setBusy(true);
    try {
      if (await send()) setSent(true);
      else setError(t('stylistAuth.signUp.error'));
    } catch {
      setError(t('stylistAuth.signUp.error'));
    } finally {
      setBusy(false);
    }
  };

  return <div className="stylist-auth stylist-auth--signup">
    <header className="stylist-auth__top stylist-auth__top--dark">
      <Link className="stylist-auth__wordmark" to="/">mova</Link>
    </header>

    <div className="stylist-auth__split">
      {!sent && <section className="stylist-auth__pitch" aria-labelledby="stylist-signup-why">
        <svg className="stylist-auth__leaf" aria-hidden="true" width="260" height="280" viewBox="0 0 210 230" fill="none">
          <path d="M150 220C150 140 120 80 60 30" stroke="var(--botanical)" strokeWidth="2" />
          <path d="M128 150C90 150 62 128 52 92C88 92 116 112 128 150Z" fill="var(--botanical)" />
          <path d="M140 110C150 74 176 52 206 48C204 84 180 106 140 110Z" fill="var(--botanical)" />
          <circle cx="176" cy="160" r="8" fill="var(--peach)" />
        </svg>
        <div className="stylist-auth__pitch-copy">
          <span className="stylist-auth__pill">{t('stylistAuth.signUp.forIndependent')}</span>
          <h2 id="stylist-signup-why">{t('stylistAuth.signUp.pitchTitle')}</h2>
          <p>{t('stylistAuth.signUp.pitchBody')}</p>
        </div>
        <ul className="stylist-auth__features">
          <li><FeatureIcon><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></FeatureIcon><span><strong>{t('stylistAuth.signUp.featureBookingsTitle')}</strong><span>{t('stylistAuth.signUp.featureBookingsBody')}</span></span></li>
          <li><FeatureIcon><circle cx="9" cy="8" r="3.5" /><path d="M3 20c.8-3.6 3.2-5.5 6-5.5s5.2 1.9 6 5.5M16 6.5a3 3 0 0 1 0 5.6M18 14.8c1.6.7 2.6 2.4 3 5.2" /></FeatureIcon><span><strong>{t('stylistAuth.signUp.featureClientsTitle')}</strong><span>{t('stylistAuth.signUp.featureClientsBody')}</span></span></li>
          <li><FeatureIcon><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" /><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></FeatureIcon><span><strong>{t('stylistAuth.signUp.featureChairTitle')}</strong><span>{t('stylistAuth.signUp.featureChairBody')}</span></span></li>
        </ul>
        <div className="stylist-auth__free">
          <button type="button" className="stylist-auth__start" onClick={startFree}>{t(trialMarketingEnabled ? 'stylistAuth.signUp.freeTitleTrial' : 'stylistAuth.signUp.freeTitle')}</button>
          <span>{t('stylistAuth.signUp.freeBody')} <Link className="stylist-auth__accent" to="/pricing">{t('stylistAuth.signUp.seePlans')}</Link></span>
        </div>
      </section>}

      <section className="stylist-auth__form-panel" aria-labelledby="stylist-signup-h">
        {sent ? <div className="stylist-auth__form-column">
          <div className="stylist-auth__progress" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((index) => <span key={index} className={index === 0 ? 'is-current' : undefined} />)}
          </div>
          <span className="stylist-auth__step">{t('stylistAuth.signUp.step')}</span>
          <CheckEmailPanel email={email.trim()} onResend={send} onVerify={verify} onChangeEmail={() => setSent(false)} />
        </div> : <form className="stylist-auth__form-column" onSubmit={(event) => void submit(event)}>
          <div className="stylist-auth__progress" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((index) => <span key={index} className={index === 0 ? 'is-current' : undefined} />)}
          </div>
          <span className="stylist-auth__step">{t('stylistAuth.signUp.step')}</span>
          <h1 id="stylist-signup-h" className="stylist-auth__title">{t('stylistAuth.signUp.title')}</h1>

          <div className="stylist-auth__name-row">
            <div className="stylist-auth__field">
              <label htmlFor="stylist-signup-first">{t('stylistAuth.signUp.firstName')}</label>
              <input id="stylist-signup-first" name="given-name" autoComplete="given-name" required maxLength={80} value={firstName} onChange={(event) => setFirstName(event.currentTarget.value)} />
            </div>
            <div className="stylist-auth__field">
              <label htmlFor="stylist-signup-last">{t('stylistAuth.signUp.lastName')}</label>
              <input id="stylist-signup-last" name="family-name" autoComplete="family-name" required maxLength={80} value={lastName} onChange={(event) => setLastName(event.currentTarget.value)} />
            </div>
          </div>
          <p className="stylist-auth__hint">{t('stylistAuth.signUp.namesPrivate')}</p>
          <div className="stylist-auth__field">
            <label htmlFor="stylist-signup-email">{t('stylistAuth.signUp.email')}</label>
            <input id="stylist-signup-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
          </div>

          {error && <p className="stylist-auth__error" role="alert">{error}</p>}
          <button className="stylist-auth__submit" type="submit" disabled={busy}>{t(busy ? 'stylistAuth.signUp.submitting' : 'stylistAuth.signUp.submit')}</button>
          <p className="stylist-auth__legal">{t('stylistAuth.signUp.legal')}</p>

          <div className="stylist-auth__aside"><p>{t('stylistAuth.signUp.haveAccount')} <Link className="stylist-auth__strong" to="/login">{t('stylistAuth.signUp.signIn')}</Link></p></div>
        </form>}
      </section>
    </div>
  </div>;
}
