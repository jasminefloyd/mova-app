import type { createMovaSupabaseClient } from '../../lib/supabase';
import { displayId, parseDisplayId } from '../../lib/display-ids';
import { operatorLocation } from '../../app/operator-url';

type Supabase = ReturnType<typeof createMovaSupabaseClient>;
export type WorkspaceChoice = { id: string; label: string };
export type WorkspaceResolution =
  | { kind: 'none' }
  | { kind: 'one'; businessId: string }
  | { kind: 'choose'; choices: WorkspaceChoice[] };

/**
 * Which business a freshly signed-in stylist should open. A `returnTo` that names a business (for example
 * /BID-12/settings) limits the answer to that business; otherwise every active membership counts.
 */
export async function resolveWorkspaces(supabase: Supabase, userId: string, returnTo: string): Promise<WorkspaceResolution> {
  const requestedId = returnTo.match(/^\/([^/]+)(?:\/|$)/)?.[1];
  let requestedBusinessId = requestedId ? decodeURIComponent(requestedId) : null;
  const requestedNumber = parseDisplayId('BID', requestedBusinessId ?? undefined);
  if (requestedNumber) {
    const { data: requestedBusiness } = await supabase.from('mova_artist_businesses').select('id').eq('business_number', requestedNumber).maybeSingle();
    requestedBusinessId = requestedBusiness?.id ?? null;
  }
  let membershipQuery = supabase.from('mova_artist_memberships').select('artist_business_id').eq('user_id', userId).eq('status', 'active');
  if (requestedId) membershipQuery = membershipQuery.eq('artist_business_id', requestedBusinessId ?? '00000000-0000-0000-0000-000000000000');
  const { data: memberships, error } = await membershipQuery.limit(requestedId ? 1 : 100);
  if (error) throw error;
  if (requestedId && !memberships?.length) throw new Error('WORKSPACE_ACCESS_DENIED');
  if (memberships?.length === 1 && memberships[0]) return { kind: 'one', businessId: memberships[0].artist_business_id };
  if ((memberships?.length ?? 0) > 1) {
    const ids = memberships!.map((item) => item.artist_business_id);
    const { data: profiles } = await supabase.from('mova_artist_profiles').select('artist_business_id, display_name').in('artist_business_id', ids);
    return { kind: 'choose', choices: ids.map((id) => ({ id, label: profiles?.find((profile) => profile.artist_business_id === id)?.display_name ?? id })) };
  }
  return { kind: 'none' };
}

/** Stores the chosen business for this tab and returns where to go next (the operator app, or a path inside it). */
export async function openWorkspace(supabase: Supabase, businessId: string, returnTo = ''): Promise<string> {
  const { data: business } = await supabase.from('mova_artist_businesses').select('business_number').eq('id', businessId).maybeSingle();
  if (!business?.business_number) throw new Error('BUSINESS_DISPLAY_ID_MISSING');
  const routeId = displayId('BID', business.business_number);
  window.sessionStorage.setItem('mova_active_artist_business_id', businessId);
  window.sessionStorage.setItem('mova_active_artist_business_display_id', routeId);
  const prefix = `/${encodeURIComponent(routeId)}`;
  const legacyPrefix = `/${encodeURIComponent(businessId)}`;
  const matchedPrefix = returnTo === prefix || returnTo === `${prefix}/` ? prefix : returnTo.startsWith(`${prefix}/`) ? prefix
    : returnTo === legacyPrefix || returnTo === `${legacyPrefix}/` ? legacyPrefix : returnTo.startsWith(`${legacyPrefix}/`) ? legacyPrefix : '';
  const path = matchedPrefix ? (returnTo === matchedPrefix || returnTo === `${matchedPrefix}/` ? '' : returnTo.slice(matchedPrefix.length + 1)) : '';
  return operatorLocation(businessId, path);
}

/** Moves to a target from openWorkspace: a full URL on the ops host, or a router path. */
export function goTo(target: string, navigate: (to: string, options: { replace: boolean }) => void) {
  if (target.startsWith('https://')) window.location.assign(target);
  else navigate(target, { replace: true });
}
