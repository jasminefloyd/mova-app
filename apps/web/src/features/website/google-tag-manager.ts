const CONTAINER_ID = 'GTM-KT7RSDNS';
const SCRIPT_ID = 'mova-google-tag-manager';
const signupConversions = new Set<string>();

type GoogleTag = (...args: unknown[]) => void;
type GoogleTagWindow = Window & { dataLayer?: unknown[]; gtag?: GoogleTag };

export function installGoogleTagManager(): void {
  if (typeof window === 'undefined') return;
  const { hostname, protocol } = window.location;
  if (protocol !== 'https:' || !['mova-beauty.co', 'www.mova-beauty.co'].includes(hostname)) return;
  if ((window.navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  if (document.getElementById(SCRIPT_ID)) return;

  const googleWindow: GoogleTagWindow = window;
  const layer = googleWindow.dataLayer ??= [];
  // Google tag commands are queued as arguments objects, as in the gtag.js bootstrap.
  // eslint-disable-next-line prefer-rest-params
  const gtag = googleWindow.gtag ??= function gtag() { layer.push(arguments); };
  const startedAt = new Date();
  gtag('set', 'allow_ad_personalization_signals', false);
  gtag('js', startedAt);
  layer.push({ 'gtm.start': startedAt.getTime(), event: 'gtm.js' });

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${CONTAINER_ID}`;
  document.head.append(script);
}

export function trackTagManagerSignup(startedAt: number | null, account: { id: string; created_at: string }): void {
  if (startedAt === null) return;
  const createdAt = Date.parse(account.created_at);
  const clockToleranceMs = 5_000;
  // Supabase can verify an existing user from the signup form. Count only accounts created during this attempt.
  if (!Number.isFinite(createdAt) || createdAt < startedAt - clockToleranceMs || createdAt > Date.now() + clockToleranceMs) return;

  installGoogleTagManager();
  const layer = (window as GoogleTagWindow).dataLayer;
  if (!layer || !document.getElementById(SCRIPT_ID) || signupConversions.has(account.id)) return;

  const storageKey = `mova_gtm_signup:${account.id}`;
  try {
    if (window.localStorage.getItem(storageKey)) return;
  } catch { /* Storage is optional. */ }

  try {
    layer.push({ event: 'mova_stylist_signup', value: 1.0, currency: 'USD' });
  } catch { return; }
  signupConversions.add(account.id);
  try { window.localStorage.setItem(storageKey, '1'); } catch { /* The in-memory check still applies. */ }
}
