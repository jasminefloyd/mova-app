const publicOrigin = 'https://mova-beauty.co';
const operatorOrigin = 'https://ops.mova-beauty.co';
const adminOrigin = 'https://admin.mova-beauty.co';

export function artistPublicUrl(handle: string, locale: 'en-US'|'es-US' = 'en-US') {
  return `${publicOrigin}/a/${encodeURIComponent(handle)}?locale=${locale}`;
}
export function operatorPortalUrl(businessDisplayId: string) { return `${operatorOrigin}/${encodeURIComponent(businessDisplayId)}`; }
export function adminPortalUrl() { return adminOrigin; }
