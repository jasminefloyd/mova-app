import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Icon, TextField } from '../../components';
import { HCaptcha } from '../../components/HCaptcha';
import { hcaptchaSiteKey, waitlistEnabled } from '../../lib/env';

type WorkArrangement = 'booth_chair_renter' | 'suite_renter' | 'commission_stylist' | 'other_beauty_professional';
type WaitlistValues = { email: string; workArrangement: WorkArrangement; marketingOptIn: boolean; captchaToken: string | null };
type FormTone = 'light' | 'dark';

export default function MarketingHome() {
  const { t, i18n } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [joined, setJoined] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const submit = async (values: WaitlistValues): Promise<boolean> => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anonKey) { setSubmitError(true); return false; }
    setSubmitting(true);
    setSubmitError(false);
    try {
      const response = await fetch(`${url}/functions/v1/waitlist-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey },
        body: JSON.stringify({ email: values.email, work_arrangement: values.workArrangement, marketing_opt_in: values.marketingOptIn, locale: i18n.language === 'es-US' ? 'es-US' : 'en-US', ...(values.captchaToken ? { captcha_token: values.captchaToken } : {}) }),
      });
      if (!response.ok) throw new Error('WAITLIST_SUBMISSION_FAILED');
      const result = await response.json();
      if (result.data?.saved !== true) throw new Error('WAITLIST_SUBMISSION_FAILED');
      setJoined(true);
      return true;
    } catch {
      setSubmitError(true);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const playWalkthrough = () => { void videoRef.current?.play(); };

  return <div className="mova-marketing-home">
    <header className="mova-marketing-home__header">
      <div className="mova-marketing-home__header-inner">
        <Link className="mova-marketing-home__wordmark" to="/" aria-label={t('marketing.home')}>mova</Link>
        <nav aria-label={t('marketing.account')}>
          <Link className="mova-marketing-home__signin" to="/auth">{t('marketing.signIn')}</Link>
          <Link className="mova-marketing-home__signup" to="/auth">{t('marketing.signUp')}</Link>
        </nav>
      </div>
    </header>

    <main>
      <section className={`mova-marketing-home__hero${joined ? ' is-joined' : ''}`}>
        <div className="mova-marketing-home__hero-copy">
          <p className="mova-marketing-home__badge">{t('marketing.comingSoon')}</p>
          <h1>{t('marketing.headline')}</h1>
          <p className="mova-marketing-home__intro">{t('marketing.intro')}</p>
          <WaitlistForm tone="light" enabled={waitlistEnabled} joined={joined} submitting={submitting} error={submitError} onSubmit={submit} />
        </div>
        <figure className="mova-marketing-home__walkthrough">
          <video ref={videoRef} controls preload="metadata" playsInline poster="/media/Mova_Walkthrough_poster.jpg" aria-label={t('marketing.walkthrough')}>
            <source src="/media/Mova_Loop_40s.mp4" type="video/mp4" />
          </video>
          <button type="button" className="mova-marketing-home__video-link" onClick={playWalkthrough}>
            <span aria-hidden="true" />{t('marketing.watchWalkthrough')}
          </button>
        </figure>
      </section>

      <section className="mova-marketing-home__benefits">
        <div className="mova-marketing-home__benefits-inner">
          <h2>{t('marketing.benefitsTitle')}</h2>
          <div className="mova-marketing-home__benefit-grid">
            <article className="mova-marketing-home__benefit-card">
              <span className="mova-marketing-home__benefit-icon"><Icon name="qr" size={24} /></span>
              <h3>{t('marketing.benefitScanTitle')}</h3><p>{t('marketing.benefitScanBody')}</p>
            </article>
            <article className="mova-marketing-home__benefit-card">
              <span className="mova-marketing-home__benefit-icon"><Icon name="calendar" size={24} /></span>
              <h3>{t('marketing.benefitGapsTitle')}</h3><p>{t('marketing.benefitGapsBody')}</p>
            </article>
            <article className="mova-marketing-home__benefit-card">
              <span className="mova-marketing-home__benefit-icon"><Icon name="user" size={24} /></span>
              <h3>{t('marketing.benefitClientsTitle')}</h3><p>{t('marketing.benefitClientsBody')}</p>
            </article>
          </div>
        </div>
      </section>

      <section className="mova-marketing-home__closing">
        <div className="mova-marketing-home__closing-inner">
          <h2>{t('marketing.closingTitle')}</h2>
          <p>{t('marketing.closingBody')}</p>
          <WaitlistForm tone="dark" enabled={waitlistEnabled} joined={joined} submitting={submitting} error={submitError} onSubmit={submit} />
        </div>
      </section>
    </main>

    <footer className="mova-marketing-home__footer">
      <div><span>{t('marketing.copyright', { year: new Date().getFullYear() })}</span><nav aria-label={t('marketing.legal')}><span aria-disabled="true">{t('marketing.privacy')}</span><span aria-disabled="true">{t('marketing.terms')}</span></nav></div>
    </footer>
  </div>;
}

function WaitlistForm({ tone, enabled, joined, submitting, error, onSubmit }: { tone: FormTone; enabled: boolean; joined: boolean; submitting: boolean; error: boolean; onSubmit: (values: WaitlistValues) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [workArrangement, setWorkArrangement] = useState<WorkArrangement>('booth_chair_renter');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [localError, setLocalError] = useState(false);
  const { i18n } = useTranslation();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [captchaLoadError, setCaptchaLoadError] = useState(false);
  const onCaptchaLoadError = useCallback(() => setCaptchaLoadError(true), []);

  if (!enabled) return <div className={`mova-marketing-home__success mova-marketing-home__success--${tone}`} role="status">
    <span><strong>{t('marketing.waitlistClosedTitle')}</strong><small>{t('marketing.waitlistClosedBody')}</small></span>
  </div>;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(false);
    if (!email.trim()) { setLocalError(true); return; }
    if (hcaptchaSiteKey && !captchaToken) { setLocalError(true); return; }
    void onSubmit({ email: email.trim(), workArrangement, marketingOptIn, captchaToken }).then((ok) => { if (!ok) setCaptchaReset((n) => n + 1); });
  };

  if (joined) return <div className={`mova-marketing-home__success mova-marketing-home__success--${tone}`} role="status">
    <span className="mova-marketing-home__success-icon"><Icon name="check" size={24} /></span>
    <span><strong>{t('marketing.joinedTitle')}</strong><small>{t('marketing.joinedBody')}</small></span>
  </div>;

  return <form className={`mova-marketing-home__form mova-marketing-home__form--${tone}`} onSubmit={handleSubmit}>
    <div className="mova-marketing-home__fields">
      <TextField type="email" label={t('marketing.email')} placeholder={t('marketing.emailPlaceholder')} autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
      <label className="mova-field"><span className="mova-field__label">{t('marketing.workQuestion')}</span>
        <select className="mova-input" value={workArrangement} onChange={(event) => setWorkArrangement(event.currentTarget.value as WorkArrangement)}>
          <option value="booth_chair_renter">{t('marketing.workBooth')}</option>
          <option value="suite_renter">{t('marketing.workSuite')}</option>
          <option value="commission_stylist">{t('marketing.workCommission')}</option>
          <option value="other_beauty_professional">{t('marketing.workOther')}</option>
        </select>
      </label>
    </div>
    <Checkbox checked={marketingOptIn} onChange={(event) => setMarketingOptIn(event.currentTarget.checked)} label={t('marketing.marketingOptIn')} />
    {(error || localError) && <p className="mova-marketing-home__form-error" role="alert">{t(!localError ? 'marketing.submitError' : !email.trim() ? 'marketing.emailRequired' : 'marketing.captchaRequired')}</p>}
    <HCaptcha siteKey={hcaptchaSiteKey} locale={i18n.language} onToken={setCaptchaToken} resetKey={captchaReset} onLoadError={onCaptchaLoadError} />
    {captchaLoadError && <p className="mova-marketing-home__form-error" role="alert">{t('marketing.captchaUnavailable')}</p>}
    <Button type="submit" loading={submitting} className="mova-marketing-home__submit">{t('marketing.join')}</Button>
    <p className="mova-marketing-home__privacy-note">{t('marketing.privacyNote')} <span aria-disabled="true">{t('marketing.privacy')}</span></p>
  </form>;
}
