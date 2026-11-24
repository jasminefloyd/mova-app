import { discoveryLabel, discoveryPath, PRICEPILOT_CAMPAIGN, PRICEPILOT_CONTENT, type DiscoveryEvent } from './discovery-contract';

const key = 'mova_discovery_visit';
const visitorKey = 'mova_discovery_browser';
const visitTimeout = 30 * 60 * 1000;
type Visit = Pick<DiscoveryEvent, 'visit' | 'landing' | 'channel' | 'source' | 'medium' | 'campaign' | 'content' | 'referrer'> & { seenAt: number };
let visit: Visit | undefined;
let lastPage: string | undefined;
let pending: { visit: string; request: Promise<unknown> } | undefined;

function browserVisitor(): string | undefined {
  try {
    const saved = localStorage.getItem(visitorKey);
    if (saved && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(saved)) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(visitorKey, id);
    return id;
  } catch { return undefined; }
}

function channelFor(host: string, paidSearch: boolean): Visit['channel'] {
  if (paidSearch) return 'paid search';
  if (/(^|\.)(instagram\.com|facebook\.com|tiktok\.com|linkedin\.com|youtube\.com|reddit\.com|pinterest\.com|x\.com|t\.co)$/.test(host)) return 'social';
  if (/(^|\.)(google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})|bing\.com|search\.yahoo\.com|duckduckgo\.com)$/.test(host)) return 'organic search';
  return host ? 'referral' : 'direct / unknown';
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
  const campaign = params.get('utm_campaign') === PRICEPILOT_CAMPAIGN ? PRICEPILOT_CAMPAIGN : '';
  const content = campaign && params.get('utm_content') === PRICEPILOT_CONTENT ? PRICEPILOT_CONTENT : '';
  const newCampaign = campaign && (campaign !== visit?.campaign || content !== (visit?.content ?? ''));
  if (!visit || !(now - visit.seenAt < visitTimeout) || newCampaign) {
    let host = '';
    try {
      const referrer = new URL(document.referrer);
      if (referrer.hostname.replace(/^www\./, '') !== window.location.hostname.replace(/^www\./, '')) host = discoveryLabel.safeParse(referrer.hostname).data ?? '';
    } catch { /* No usable external referrer. */ }
    const hasPaidClick = ['gclid', 'gbraid', 'wbraid', 'msclkid'].some(name => params.has(name));
    visit = {
      visit: crypto.randomUUID(), landing: path, seenAt: now,
      channel: channelFor(host, Boolean(campaign) || hasPaidClick),
      source: campaign ? 'google' : hasPaidClick ? (params.has('msclkid') ? 'bing' : 'google') : host,
      medium: '', campaign, content, referrer: host,
    };
  }
  visit.seenAt = now;
  try { sessionStorage.setItem(key, JSON.stringify(visit)); } catch { /* Optional storage. */ }
  return visit;
}

function send(path: string, signupClick: boolean) {
  const active = activeVisit(path);
  if (!active) return;
  const { visit, landing, channel, source, campaign, content = '', referrer = '' } = active;
  const visitor = browserVisitor();
  const event: DiscoveryEvent = { visit, landing, channel, source, medium: '', campaign, content, referrer, ...(visitor ? { visitor } : {}), path, signupClick, event: crypto.randomUUID() };
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
