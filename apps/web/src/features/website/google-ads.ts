const TAG_ID = 'AW-1006543418';
const SIGNUP_DESTINATION = `${TAG_ID}/ZXZkCPODpL4dELrE-t8D`;
const SCRIPT_ID = 'mova-google-ads';
const signupConversions = new Set<string>();

type GoogleTag = (...args: unknown[]) => void;
type AdsWindow = Window & { dataLayer?: unknown[]; gtag?: GoogleTag };

export function installGoogleAdsTag(): void {
  if (typeof window === 'undefined') return;
  const { hostname, protocol } = window.location;
  if (protocol !== 'https:' || !['mova-beauty.co', 'www.mova-beauty.co'].includes(hostname)) return;
  if ((window.navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  if (document.getElementById(SCRIPT_ID)) return;

  const adsWindow: AdsWindow = window;
  const layer = adsWindow.dataLayer ??= [];
  // Google tag commands are queued as arguments objects, as in the gtag.js bootstrap.
  // eslint-disable-next-line prefer-rest-params
  const gtag = adsWindow.gtag ??= function gtag() { layer.push(arguments); };
  gtag('js', new Date());
  gtag('config', TAG_ID, { allow_ad_personalization_signals: false });

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${TAG_ID}`;
  document.head.append(script);
}

export function trackGoogleAdsSignup(startedAt: number | null, account: { id: string; created_at: string }): void {
  if (startedAt === null) return;
  const createdAt = Date.parse(account.created_at);
  const clockToleranceMs = 5_000;
  // Supabase can verify an existing user from the signup form. Count only accounts created during this attempt.
  if (!Number.isFinite(createdAt) || createdAt < startedAt - clockToleranceMs || createdAt > Date.now() + clockToleranceMs) return;

  installGoogleAdsTag();
  const gtag = (window as AdsWindow).gtag;
  if (!gtag || !document.getElementById(SCRIPT_ID) || signupConversions.has(account.id)) return;

  const storageKey = `mova_google_ads_signup:${account.id}`;
  try {
    if (window.localStorage.getItem(storageKey)) return;
  } catch { /* Storage is optional. */ }

  try {
    gtag('event', 'conversion', { send_to: SIGNUP_DESTINATION, value: 1.0, currency: 'USD' });
  } catch { return; }
  signupConversions.add(account.id);
  try { window.localStorage.setItem(storageKey, '1'); } catch { /* The in-memory check still applies. */ }
}
