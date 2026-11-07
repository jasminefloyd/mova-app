import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const weekToDate = body.range === 'week_to_date';
  const period = [7, 30, 90].includes(body.period) ? Number(body.period) : 30;
  const { data: location, error: locationError } = await actor.client.from('mova_locations')
    .select('time_zone').eq('artist_business_id', actor.businessId).eq('is_active', true).order('created_at').limit(1).maybeSingle();
  if (locationError) return respond({ code: 'REPORT_TIME_ZONE_UNAVAILABLE' }, 500);
  const timeZone = location?.time_zone ?? 'UTC';
  let end: string;
  try { end = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce((value, part) => part.type === 'year' ? value.replace('YYYY', part.value) : part.type === 'month' ? value.replace('MM', part.value) : part.type === 'day' ? value.replace('DD', part.value) : value, 'YYYY-MM-DD'); }
  catch { return respond({ code: 'REPORT_TIME_ZONE_INVALID' }, 500); }
  const endDay = end;
  const startDate = new Date(`${endDay}T00:00:00.000Z`);
  const days = weekToDate ? (startDate.getUTCDay() + 6) % 7 + 1 : period;
  startDate.setUTCDate(startDate.getUTCDate() - days + 1);
  const { data, error } = await serviceClient().rpc('mova_reports_summary', {
    p_artist_business_id: actor.businessId,
    p_start: startDate.toISOString().slice(0, 10),
    p_end: endDay,
  });
  if (error) return respond({ code: error.message || 'REPORT_SUMMARY_FAILED' }, 500);
  const includeGoogle = Deno.env.get('MOVA_GOOGLE_REVIEWS_ENABLED') === 'true' && Deno.env.get('MOVA_PUBLIC_REVIEWS_ENABLED') === 'true';
  if (!includeGoogle && data?.current && data?.previous) {
    data.current.google_rating_sum = 0;
    data.current.google_rating_count = 0;
    data.previous.google_rating_sum = 0;
    data.previous.google_rating_count = 0;
  }
  return respond({ ...data, period: days, range: weekToDate ? 'week_to_date' : 'rolling', time_zone: timeZone });
});
