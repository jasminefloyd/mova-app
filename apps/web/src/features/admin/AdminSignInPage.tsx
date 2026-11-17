import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { adminRpc } from './admin-api';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { currentAdminSession, deviceLabel, safeReturnTo, signOutAdmin } from './admin-session';

type Step = 'email' | 'email-code' | 'authenticator';

/** Passwordless email link/code followed by the required authenticator factor. */
export default function AdminSignInPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const supabase = useMemo(() => createMovaSupabaseClient(), []);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<{ qr: string; secret: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sessionTransition = useRef<Promise<void> | null>(null);

  const prepareAdminSecondFactor = useCallback(async () => {
    if (step === 'authenticator') return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const who = await adminRpc<{ is_admin: boolean }>('mova_admin_whoami');
    if (!who.is_admin) {
      await signOutAdmin();
      setStep('email');
      setMessage('This account does not have System Admin access.');
      return;
    }

    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) throw listError;
    const verified = factors.totp.find((factor) => factor.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setEnrolling(null);
    } else {
      // Remove abandoned, unverified enrollment factors before starting a fresh setup.
      for (const factor of factors.totp) await supabase.auth.mfa.unenroll({ factorId: factor.id });
      const { data: enroll, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Mova admin' });
      if (enrollError || !enroll) throw enrollError ?? new Error('Authenticator enrollment failed');
      setFactorId(enroll.id);
      setEnrolling({ qr: enroll.totp.qr_code, secret: enroll.totp.secret });
    }
    setCode('');
    setMessage(null);
    setStep('authenticator');
  }, [step, supabase]);

  const continueWithSession = useCallback(() => {
    if (sessionTransition.current) return sessionTransition.current;
    sessionTransition.current = prepareAdminSecondFactor().finally(() => { sessionTransition.current = null; });
    return sessionTransition.current;
  }, [prepareAdminSecondFactor]);

  // Secure email links return to this route. Supabase consumes the callback and restores the session.
  useEffect(() => {
    let active = true;
    const handleSession = () => {
      if (!active) return;
      void continueWithSession().catch(() => {
        if (active) setMessage('Could not verify your admin access. Request a new sign-in link.');
      });
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) window.setTimeout(handleSession, 0);
    });
    void currentAdminSession().then((session) => {
      if (active && session) navigate(returnTo, { replace: true });
    }).catch(() => undefined);
    void supabase.auth.getSession().then(({ data: { session } }) => { if (session) handleSession(); }).catch(() => undefined);
    return () => { active = false; subscription.unsubscribe(); };
  }, [continueWithSession, navigate, returnTo, supabase]);

  const idleNotice = params.get('reason') === 'idle' ? 'You were signed out after 30 minutes without activity.' : null;

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });
      if (error) {
        // Supabase may suppress unknown-account responses; keep the user-facing result generic.
        if (!/signups? not allowed|user not found/i.test(error.message)) throw error;
      }
      setStep('email-code');
      setMessage('If this email belongs to a System Admin, a six-digit sign-in code is on the way.');
    } catch {
      setMessage('Could not send the sign-in email. Check that this is your System Admin email and try again.');
    } finally { setBusy(false); }
  }

  async function submitEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
      if (error) throw error;
      await continueWithSession();
    } catch {
      setCode('');
      setMessage('That email code did not work. Use the newest code in your email.');
    } finally { setBusy(false); }
  }

  async function submitAuthenticatorCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) {
      setBusy(false);
      setMessage('That code did not work. Use the newest code in your authenticator app.');
      return;
    }
    const session = await currentAdminSession();
    if (!session) {
      await signOutAdmin();
      setBusy(false);
      setStep('email');
      setCode('');
      setMessage('This account does not have System Admin access.');
      return;
    }
    try { await adminRpc('mova_admin_record_sign_in', { p_device: deviceLabel() }); } catch { /* best effort audit entry */ }
    queryClient.removeQueries({ queryKey: ['admin'] });
    navigate(returnTo, { replace: true });
  }

  return (
    <div className="adm adm-signin">
      <div className="adm-signin-wrap">
        <div className="adm-signin-brand"><b>mova</b><span className="pill">Admin</span></div>
        {step === 'email' ? (
            <form className="adm-signin-card" aria-labelledby="as-h" onSubmit={(event) => void sendCode(event)}>
            <h1 id="as-h" className="h1">Sign in</h1>
            <p className="sub">For Mova System Admins. We’ll email you a six-digit sign-in code.</p>
            {idleNotice ? <p className="notice" role="status">{idleNotice}</p> : null}
            <div className="field">
              <label htmlFor="as-e">Work email</label>
              <input id="as-e" type="email" autoComplete="email" className="input" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            {message ? <p className="error-text" role="status">{message}</p> : null}
            <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in code'}</button>
          </form>
        ) : step === 'email-code' ? (
          <form className="adm-signin-card" aria-labelledby="as-h" onSubmit={(event) => void submitEmailCode(event)}>
            <h1 id="as-h" className="h1">Check your email</h1>
            <p className="sub">Enter the six-digit code sent to <strong>{email.trim()}</strong>.</p>
            <div className="field">
              <label htmlFor="as-c">Email code</label>
              <input id="as-c" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="input big-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required />
            </div>
            {message ? <p className="error-text" role="status">{message}</p> : null}
            <button type="submit" className="btn pri" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify email'}</button>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void sendCode()}>{busy ? 'Sending…' : 'Resend code'}</button>
            <button type="button" className="btn sm ghost" onClick={() => { setStep('email'); setCode(''); setMessage(null); }}>Change email</button>
          </form>
        ) : (
          <form className="adm-signin-card" aria-labelledby="as-h" onSubmit={(event) => void submitAuthenticatorCode(event)}>
            <h1 id="as-h" className="h1">Authenticator code</h1>
            <p className="sub">{enrolling ? 'Scan this code with your authenticator app, then enter the six-digit code it shows.' : 'Enter the six-digit code from your Mova admin authenticator app.'}</p>
            {enrolling ? <div className="adm-enroll"><img src={enrolling.qr} alt="Authenticator setup QR code" width={180} height={180} /><p className="small">Can’t scan? Enter this key: <span className="mono">{enrolling.secret}</span></p></div> : null}
            <div className="field">
              <label htmlFor="as-totp">6-digit authenticator code</label>
              <input id="as-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="input big-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required />
            </div>
            {message ? <p className="error-text" role="alert">{message}</p> : null}
            <button type="submit" className="btn pri" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and sign in'}</button>
          </form>
        )}
        <p className="adm-signin-note">Every sign-in and action here is logged. Sessions end after 30 minutes idle.</p>
      </div>
    </div>
  );
}
