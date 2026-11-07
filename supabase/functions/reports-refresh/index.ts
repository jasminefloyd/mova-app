import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) return respond({ code: 'UNAUTHORIZED' }, 401);
  const db = serviceClient();
  const { data: businesses, error } = await db.from('mova_artist_businesses').select('id').eq('status', 'active').limit(1000);
  if (error) return respond({ code: 'REPORT_BUSINESSES_UNAVAILABLE' }, 500);
  let refreshed = 0;
  for (const business of businesses ?? []) {
    const { data: location, error: locationError } = await db.from('mova_locations').select('time_zone').eq('artist_business_id', business.id).eq('is_active', true).order('created_at').limit(1).maybeSingle();
    if (locationError) return respond({ code: 'REPORT_TIME_ZONE_UNAVAILABLE' }, 500);
    const zone = location?.time_zone ?? 'UTC';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const today = `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}-${parts.find((p) => p.type === 'day')?.value}`;
    for (const date of [today]) {
      const { error: refreshError } = await db.rpc('mova_reports_refresh_daily', { p_artist_business_id: business.id, p_local_date: date });
      if (refreshError) return respond({ code: 'REPORT_REFRESH_FAILED' }, 500);
      refreshed += 1;
    }
  }
  return respond({ refreshed_business_days: refreshed });
});
