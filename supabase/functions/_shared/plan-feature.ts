import { serviceClient } from './booking.ts';

/** Fail closed unless the assigned plan and any stylist/client override allow this feature. */
export async function planFeatureEnabled(
  artistBusinessId: string,
  featureKey: string,
  customerAccountId?: string | null,
): Promise<boolean> {
  try {
    const { data, error } = await serviceClient().rpc('mova_feature_gate', {
      p_artist_business_id: artistBusinessId,
      p_feature_key: featureKey,
      p_customer_account_id: customerAccountId ?? null,
    });
    return !error && data?.enabled === true;
  } catch {
    return false;
  }
}
