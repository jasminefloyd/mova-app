import { serviceClient } from './booking.ts';

type PlatformSwitchKey = 'autopilot' | 'concierge' | 'seat_filler' | 'zelle' | 'reviews' | 'spanish' | 'tap_to_pay';

/** Read admin-managed product switches from the private table. Missing/error always means off. */
export async function platformSwitchEnabled(key: PlatformSwitchKey): Promise<boolean> {
  try {
    const { data, error } = await serviceClient().from('mova_platform_switches').select('enabled').eq('key', key).maybeSingle();
    return !error && data?.enabled === true;
  } catch {
    return false;
  }
}
