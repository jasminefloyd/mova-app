export function operatorUrl(businessId: string | null | undefined, path = '') {
  if (!businessId) return '/auth';
  const routeId = /^BID-\d+$/i.test(businessId)
    ? businessId.toUpperCase()
    : typeof window !== 'undefined'
      && window.sessionStorage.getItem('mova_active_artist_business_id') === businessId
      ? window.sessionStorage.getItem('mova_active_artist_business_display_id')
      : null;
  if (!routeId) return '/auth';
  const suffix = path.replace(/^\/+/, '');
  return `/${encodeURIComponent(routeId)}${suffix ? `/${suffix}` : '/'}`;
}

export function operatorLocation(businessId: string | null | undefined, path = '') {
  const target = operatorUrl(businessId,path);
  if (typeof window === 'undefined') return target;
  const host = window.location.hostname;
  if (host === 'ops.mova-beauty.co' || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app')) return target;
  return `https://ops.mova-beauty.co${target}`;
}
