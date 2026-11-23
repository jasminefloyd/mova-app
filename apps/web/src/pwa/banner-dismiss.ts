/** ✕ on a Home banner hides it on this device for 15 days, whichever banner it is. */
export type HomeBannerKind = 'install' | 'upsell' | 'trial' | 'locked';
const DAYS = 15;
const key = (kind: HomeBannerKind) => `mova_home_banner_dismissed_${kind}`;

export function isBannerDismissed(kind: HomeBannerKind, now = Date.now()): boolean {
  try {
    const until = Number(window.localStorage.getItem(key(kind)) ?? 0);
    return Number.isFinite(until) && until > now;
  } catch { return false; }
}

export function dismissBanner(kind: HomeBannerKind, now = Date.now()): void {
  try { window.localStorage.setItem(key(kind), String(now + DAYS * 24 * 60 * 60 * 1000)); } catch { /* storage unavailable: hides for this visit only */ }
}
