import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { adminRpc } from './admin-api';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { currentAdminSession, deviceLabel, safeReturnTo, signOutAdmin } from './admin-session';

type Step = 'password' | 'code';

/**
 * Two steps: password, then a six-digit authenticator code. The first code also enrolls the authenticator,
 * so the very first admin enrolls on this screen. Admin rights come only from the platform admin roster.
 */
export default function AdminSignInPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<{ qr: string; secret: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void currentAdminSession().then((session) => {
      if (!cancelled && session) navigate(returnTo, { replace: true });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [navigate, returnTo]);

  const idleNotice = params.get('reason') === 'idle' ? 'You were signed out after 30 minutes without activity.' : null;

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createMovaSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setBusy(false);
      setMessage('That email and password do not match.');
      return;
    }
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      await signOutAdmin();
      setBusy(false);
      setMessage('Could not check your authenticator. Try again.');
      return;
    }
    const verified = factors.totp.find((factor) => factor.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
    } else {
      for (const factor of factors.totp) await supabase.auth.mfa.unenroll({ factorId: factor.id });
      const { data: enroll, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Mova admin' });
      if (enrollError || !enroll) {
        await signOutAdmin();
        setBusy(false);
        setMessage('Could not set up your authenticator. Try again.');
        return;
      }
      setFactorId(enroll.id);
      setEnrolling({ qr: enroll.totp.qr_code, secret: enroll.totp.secret });
    }
    setBusy(false);
    setStep('code');
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setMessage(null);
    const supabase = createMovaSupabaseClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) {
      setBusy(false);
      setMessage('That code did not work. Use the newest code in your app.');
      return;
    }
    const session = await currentAdminSession();
    if (!session) {
      await signOutAdmin();
      setBusy(false);
      setStep('password');
      setCode('');
      setMessage('This account does not have admin access.');
      return;
    }
    try {
      await adminRpc('mova_admin_record_sign_in', { p_device: deviceLabel() });
    } catch {
      // The sign-in still succeeds; the log entry is best effort.
    }
    queryClient.removeQueries({ queryKey: ['admin'] });
    navigate(returnTo, { replace: true });
  }

  return (
    <div className="adm-signin">
      <div className="adm-signin-wrap">
        <div className="adm-signin-brand"><b>mova</b><span className="pill">Admin</span></div>
        {step === 'password' ? (
          <form className="adm-signin-card" aria-labelledby="as-h" onSubmit={(event) => void submitPassword(event)}>
            <h1 id="as-h" className="h1">Sign in</h1>
            <p className="sub">For Mova staff only.</p>
            {idleNotice ? <p className="notice" role="status">{idleNotice}</p> : null}
            <div className="field">
              <label htmlFor="as-e">Work email</label>
              <input id="as-e" type="email" autoComplete="username" className="input" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="as-p">Password</label>
              <input id="as-p" type="password" autoComplete="current-password" className="input" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
            {message ? <p className="error-text" role="alert">{message}</p> : null}
            <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
          </form>
        ) : (
          <form className="adm-signin-card" aria-labelledby="as-h" onSubmit={(event) => void submitCode(event)}>
            <h1 id="as-h" className="h1">Enter your code</h1>
            <p className="sub">{enrolling ? 'Scan this code with your authenticator app, then enter the 6-digit code it shows.' : 'Open your authenticator app and enter the 6-digit code for Mova admin.'}</p>
            {enrolling ? (
              <div className="adm-enroll">
                <img src={enrolling.qr} alt="Authenticator setup QR code" width={180} height={180} />
                <p className="small">Can't scan? Enter this key: <span className="mono">{enrolling.secret}</span></p>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="as-c">6-digit code</label>
              <input id="as-c" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className="input big-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required />
            </div>
            {message ? <p className="error-text" role="alert">{message}</p> : null}
            <button type="submit" className="btn pri" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and sign in'}</button>
            <button type="button" className="btn sm ghost" onClick={() => { setStep('password'); setCode(''); setMessage(null); }}>Back</button>
          </form>
        )}
        <p className="adm-signin-note">Every sign-in and action here is logged. Sessions end after 30 minutes idle.</p>
      </div>
    </div>
  );
}
