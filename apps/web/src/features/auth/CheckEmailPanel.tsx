import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { isStandalone } from '../../pwa/device';

const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

/** Six one-digit boxes; typing moves forward, Backspace moves back, pasting fills them all. */
function CodeDigits({ value, onChange, onComplete, disabled }: { value: string; onChange: (value: string) => void; onComplete: (value: string) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? '');

  const set = (next: string, focus: number) => {
    const clean = next.replace(/\D/g, '').slice(0, CODE_LENGTH);
    onChange(clean);
    refs.current[Math.min(focus, CODE_LENGTH - 1)]?.focus();
    if (clean.length === CODE_LENGTH) onComplete(clean);
  };
  const type = (index: number, input: string) => {
    const digit = input.replace(/\D/g, '');
    if (!digit) return;
    if (digit.length > 1) { set(digit, digit.length); return; }
    set(value.slice(0, index) + digit + value.slice(index + 1), index + 1);
  };
  const key = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Backspace') return;
    event.preventDefault();
    if (digits[index]) set(value.slice(0, index) + value.slice(index + 1), index);
    else if (index > 0) set(value.slice(0, index - 1) + value.slice(index), index - 1);
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/\d/.test(text)) return;
    event.preventDefault();
    set(text, text.replace(/\D/g, '').length);
  };

  return <div className="mova-code-entry__digits" role="group" aria-label={t('signInCode.group')}>
    {digits.map((digit, index) => <input
      key={index}
      ref={(node) => { refs.current[index] = node; }}
      inputMode="numeric"
      autoComplete={index === 0 ? 'one-time-code' : 'off'}
      pattern="[0-9]*"
      maxLength={index === 0 ? CODE_LENGTH : 1}
      aria-label={t('signInCode.digit', { index: index + 1 })}
      value={digit}
      disabled={disabled}
      onChange={(event) => type(index, event.currentTarget.value)}
      onKeyDown={(event) => key(index, event)}
      onPaste={paste}
    />)}
  </div>;
}

/**
 * "Check your email" state after a passwordless one-time code is requested. The six-digit code is
 * the only sign-in method in both the browser and installed app.
 */
export function CheckEmailPanel({ email, message, onResend, onVerify, onChangeEmail }: {
  email: string;
  message?: string;
  onResend: () => Promise<boolean>;
  onVerify?: (code: string) => Promise<boolean>;
  onChangeEmail: () => void;
}) {
  const { t } = useTranslation();
  const [wait, setWait] = useState(RESEND_SECONDS);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [standalone] = useState(() => isStandalone());

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const resend = async () => {
    setBusy(true); setResent(false); setFailed(false);
    const ok = await onResend();
    setBusy(false);
    if (ok) { setResent(true); setWait(RESEND_SECONDS); setCode(''); setInvalid(false); } else setFailed(true);
  };

  const verify = async (value = code) => {
    if (!onVerify || value.length !== CODE_LENGTH || verifying) return;
    setVerifying(true); setInvalid(false);
    const ok = await onVerify(value).catch(() => false);
    setVerifying(false);
    if (!ok) setInvalid(true);
  };

  const resendButton = <button type="button" className="stylist-auth__secondary" disabled={busy || wait > 0} onClick={() => void resend()}>
    {wait > 0 ? t('stylistAuth.checkEmail.resendIn', { seconds: wait }) : t('stylistAuth.checkEmail.resend')}
  </button>;
  const notices = <>
    {invalid && <p className="stylist-auth__error" role="alert">{t('signInCode.invalid')}</p>}
    {resent && <p className="stylist-auth__notice" role="status">{t('stylistAuth.checkEmail.resent')}</p>}
    {failed && <p className="stylist-auth__error" role="alert">{t('stylistAuth.signIn.error')}</p>}
  </>;
  const digits = onVerify ? <CodeDigits value={code} onChange={(value) => { setCode(value); setInvalid(false); }} onComplete={(value) => void verify(value)} disabled={verifying} /> : null;

  if (standalone && onVerify) return <section className="stylist-auth__check mova-code-entry" aria-labelledby="stylist-auth-check-h">
    <span className="stylist-auth__check-icon" aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></svg>
    </span>
    <h1 id="stylist-auth-check-h" className="stylist-auth__title">{t('signInCode.title')}</h1>
    <p className="stylist-auth__lede"><Trans i18nKey="signInCode.body" values={{ email }} components={{ strong: <strong /> }} /></p>
    {digits}
    <p className="mova-code-entry__note">{t('signInCode.note')}</p>
    {notices}
    <button type="button" className="stylist-auth__submit" disabled={code.length !== CODE_LENGTH || verifying} onClick={() => void verify()}>{t('signInCode.submit')}</button>
    {resendButton}
    <button type="button" className="stylist-auth__text-button" onClick={onChangeEmail}>{t('signInCode.differentEmail')}</button>
  </section>;

  return <section className="stylist-auth__check" aria-labelledby="stylist-auth-check-h">
    <span className="stylist-auth__check-icon" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></svg>
    </span>
    <h1 id="stylist-auth-check-h" className="stylist-auth__title">{t('stylistAuth.checkEmail.title')}</h1>
    <p className="stylist-auth__lede">{message ?? t('stylistAuth.checkEmail.body', { email })}</p>
    <p className="stylist-auth__hint">{t('stylistAuth.checkEmail.once')} {t('stylistAuth.checkEmail.spam')}</p>
    {digits && <div className="mova-code-entry">
      <p className="mova-code-entry__note">{t('signInCode.bodyBrowser')}</p>
      {digits}
    </div>}
    {notices}
    {resendButton}
    <button type="button" className="stylist-auth__text-button" onClick={onChangeEmail}>{t('stylistAuth.checkEmail.different')}</button>
  </section>;
}
