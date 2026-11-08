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
  // Keep the operator workspace on the current origin. Supabase persists browser
  // sessions in origin-scoped storage, so switching from mova-beauty.co to its
  // ops subdomain drops the authenticated session.
  return operatorUrl(businessId,path);
}
