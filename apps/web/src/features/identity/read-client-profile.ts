import { publicEnv } from '../../lib/env';

type ClientProfile = {
  display_name?: string;
  email?: string | null;
  phone?: string | null;
  verified_contacts?: Array<{ type: 'email' | 'phone'; value: string }>;
};

export async function readClientProfile(accessToken: string, signal: AbortSignal): Promise<ClientProfile | null> {
  const response = await fetch(`${publicEnv.VITE_SUPABASE_URL}/functions/v1/customer-profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publicEnv.VITE_SUPABASE_ANON_KEY ?? '',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: 'profile' }),
    signal,
  });
  if (response.status === 401 || response.status === 404) return null;
  if (!response.ok) throw new Error('Client profile unavailable');
  const body = await response.json() as { data?: { profile?: ClientProfile } };
  return body.data?.profile ?? null;
}
