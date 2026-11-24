import { discoveryContent, discoveryLabel, discoveryPath, type DiscoveryEvent } from './discovery-contract';

const key = 'mova_discovery_visit';
const visitTimeout = 30 * 60 * 1000;
type Visit = Pick<DiscoveryEvent, 'visit' | 'landing' | 'channel' | 'source' | 'medium' | 'campaign' | 'content'> & { seenAt: number };
let visit: Visit | undefined;
let lastPage: string | undefined;
let pending: { visit: string; request: Promise<unknown> } | undefined;

function label(value: string | null, validator = discoveryLabel): string {
  const candidate = value?.trim().toLowerCase().replace(/ +/g, '-') ?? '';
  return validator.safeParse(candidate).success ? candidate : '';
}

function channelFor(source: string, medium: string, host: string, tagged: boolean, hasPaidClick: boolean): Visit['channel'] {
  if (hasPaidClick) return 'paid search';
  if (medium === 'email') return 'email';
  if (/^(social|social-media|paid-social|paidsocial)$/.test(medium)
    || /^(instagram|facebook|meta|tiktok|linkedin|youtube|reddit|pinterest|twitter|x)$/.test(source)
    || /(^|\.)(instagram\.com|facebook\.com|tiktok\.com|linkedin\.com|youtube\.com|reddit\.com|pinterest\.com|x\.com|t\.co)$/.test(host)) return 'social';
  if (/^(cpc|ppc|paidsearch|paid-search|sem)$/.test(medium)) return 'paid search';
  if (medium === 'organic' || /(^|\.)(google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})|bing\.com|search\.yahoo\.com|duckduckgo\.com)$/.test(host)) return 'organic search';
  if (medium === 'referral' || (!tagged && host)) return 'referral';
  return tagged ? 'other campaign' : 'direct / unknown';
}

function activeVisit(path: string): Visit | undefined {
  if (typeof window === 'undefined' || !discoveryPath.safeParse(path).success || !globalThis.crypto?.randomUUID
    || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  if (!visit) {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) visit = JSON.parse(saved) as Visit;
    } catch { /* Use memory if browser storage is unavailable. */ }
  }
  const now = Date.now();
  const params = new URLSearchParams(window.location.search);
  const source = label(params.get('utm_source'));
  const medium = label(params.get('utm_medium'));
  const campaign = label(params.get('utm_campaign'));
  const content = label(params.get('utm_content'), discoveryContent);
  const newCampaign = visit && ((source && source !== visit.source) || (medium && medium !== visit.medium)
    || (campaign && campaign !== visit.campaign) || (content && content !== visit.content));
  if (!visit || !(now - visit.seenAt < visitTimeout) || newCampaign) {
    let host = '';
    try {
      const referrer = new URL(document.referrer);
      if (referrer.hostname.replace(/^www\./, '') !== window.location.hostname.replace(/^www\./, '')) host = label(referrer.hostname);
    } catch { /* No usable external referrer. */ }
    const hasPaidClick = ['gclid', 'gbraid', 'wbraid', 'msclkid'].some(name => params.has(name));
    visit = {
      visit: crypto.randomUUID(), landing: path, seenAt: now,
      channel: channelFor(source, medium, host, Boolean(source || medium || campaign || content), hasPaidClick),
      source: source || (hasPaidClick ? (params.has('msclkid') ? 'bing' : 'google') : host), medium, campaign, content,
    };
  }
  visit.seenAt = now;
  try { sessionStorage.setItem(key, JSON.stringify(visit)); } catch { /* Optional storage. */ }
  return visit;
}

function send(path: string, signupClick: boolean) {
  const active = activeVisit(path);
  if (!active) return;
  const { visit, landing, channel, source, medium, campaign, content = '' } = active;
  const event: DiscoveryEvent = { visit, landing, channel, source, medium, campaign, content, path, signupClick, event: crypto.randomUUID() };
  pending = {
    visit,
    request: fetch('/api/discovery-event', { method: 'POST', body: JSON.stringify(event), credentials: 'omit', keepalive: true, referrerPolicy: 'origin' })
      .catch(() => undefined),
  };
}

export function trackDiscoveryPage(path: string, locationKey: string) {
  const page = `${path}:${locationKey}`;
  if (lastPage === page) return;
  lastPage = page;
  send(path, false);
}

export function trackDiscoverySignupClick(path: string) {
  send(path, true);
}

/** Pass the landing visit only when asking Auth to create a new stylist account. */
export async function discoverySignupVisit(): Promise<string | undefined> {
  const signupVisit = activeVisit('/signup');
  if (!signupVisit) return;
  if (pending?.visit !== signupVisit.visit) send('/signup', false);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([pending?.request, new Promise<void>(resolve => { timeout = setTimeout(resolve, 1200); })]);
  } finally {
    clearTimeout(timeout);
  }
  return signupVisit.visit;
}
