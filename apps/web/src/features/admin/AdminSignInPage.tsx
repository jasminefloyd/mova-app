import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { adminRpc } from './admin-api';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { currentAdminSession, deviceLabel, safeReturnTo, signOutAdmin } from './admin-session';

type Step = 'email' | 'email-code';

function AdminCodeDigits({ value, onChange, disabled, label }: { value: string; onChange: (value: string) => void; disabled: boolean; label: string }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? '');
  const update = (raw: string, focusIndex: number) => {
    const next = raw.replace(/\D/g, '').slice(0, 6);
    onChange(next);
    refs.current[Math.min(focusIndex, 5)]?.focus();
  };
  const type = (index: number, raw: string) => {
    const entered = raw.replace(/\D/g, '');
    if (!entered) return;
    if (entered.length > 1) { update(entered, entered.length); return; }
    update(value.slice(0, index) + entered + value.slice(index + 1), index + 1);
  };
  const keyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      update(digits[index] ? value.slice(0, index) + value.slice(index + 1) : value.slice(0, Math.max(index - 1, 0)) + value.slice(index), digits[index] ? index : Math.max(index - 1, 0));
    } else if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    else if (event.key === 'ArrowRight' && index < 5) refs.current[index + 1]?.focus();
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    event.preventDefault();
    update(pasted, pasted.length);
  };

  return <div className="adm-code-grid" role="group" aria-label={label}>
    {digits.map((digit, index) => <input
      key={index}
      ref={(node) => { refs.current[index] = node; }}
      aria-label={`${label}, digit ${index + 1}`}
      inputMode="numeric"
      autoComplete={index === 0 ? 'one-time-code' : 'off'}
      pattern="[0-9]*"
      maxLength={index === 0 ? 6 : 1}
      className="input"
      value={digit}
      disabled={disabled}
      onChange={(event) => type(index, event.currentTarget.value)}
      onKeyDown={(event) => keyDown(index, event)}
      onPaste={paste}
    />)}
  </div>;
}

/** Email-code sign-in for existing accounts on the System Admin roster. */
export default function AdminSignInPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const supabase = useMemo(() => createMovaSupabaseClient(), []);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void currentAdminSession().then((session) => {
      if (active && session) navigate(returnTo, { replace: true });
    }).catch(() => {
      if (active) setMessage('Could not check your admin session. Try signing in again.');
    });
    return () => { active = false; };
  }, [navigate, returnTo]);

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
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
      if (error || !data.session) {
        setCode('');
        setMessage('That email code did not work. Use the newest code in your email.');
        return;
      }

      const admin = await currentAdminSession();
      if (!admin) {
        await signOutAdmin();
        setStep('email');
        setCode('');
        setMessage('This account does not have System Admin access.');
        return;
      }

      try { await adminRpc('mova_admin_record_sign_in', { p_device: deviceLabel() }); } catch { /* best effort audit entry */ }
      queryClient.removeQueries({ queryKey: ['admin'] });
      navigate(returnTo, { replace: true });
    } catch {
      setCode('');
      setMessage('Could not complete sign-in. Request a new code and try again.');
    } finally { setBusy(false); }
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
        ) : (
          <form className="adm-signin-card" aria-labelledby="as-h" onSubmit={(event) => void submitEmailCode(event)}>
            <h1 id="as-h" className="h1">Check your email</h1>
            <p className="sub">Enter the six-digit code sent to <strong>{email.trim()}</strong>.</p>
            <div className="field">
              <label>Email code</label>
              <AdminCodeDigits value={code} onChange={setCode} disabled={busy} label="Email code" />
            </div>
            {message ? <p className="error-text" role="status">{message}</p> : null}
            <button type="submit" className="btn pri" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify email'}</button>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void sendCode()}>{busy ? 'Sending…' : 'Resend code'}</button>
            <button type="button" className="btn sm ghost" onClick={() => { setStep('email'); setCode(''); setMessage(null); }}>Change email</button>
          </form>
        )}
        <p className="adm-signin-note">Every sign-in and action here is logged. Sessions end after 30 minutes idle.</p>
      </div>
    </div>
  );
}
