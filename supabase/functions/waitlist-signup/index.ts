import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { isWaitlistEnabled } from '../_shared/waitlist-flag.ts';

const workArrangements = new Set(['booth_chair_renter','suite_renter','commission_stylist','other_beauty_professional']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!isWaitlistEnabled(Deno.env.get('MOVA_WAITLIST_ENABLED'))) return respond({ code: 'WAITLIST_NOT_OPEN' }, 503);
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > 4096) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 4096) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  let input: unknown;
  try { input = JSON.parse(rawBody); } catch { return respond({ code: 'INVALID_REQUEST' }, 422); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return respond({ code: 'INVALID_REQUEST' }, 422);
  const body = input as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const emailNormalized = email.toLowerCase();
  const workArrangement = typeof body.work_arrangement === 'string' ? body.work_arrangement : '';
  if (email.length < 3 || email.length > 254 || !emailPattern.test(emailNormalized)
    || !workArrangements.has(workArrangement) || typeof body.marketing_opt_in !== 'boolean') {
    return respond({ code: 'INVALID_REQUEST' }, 422);
  }

  const db = serviceClient();
  const { error } = await db.rpc('mova_waitlist_register', {
    p_email: email,
    p_email_normalized: emailNormalized,
    p_work_arrangement: workArrangement,
    p_marketing_opt_in: body.marketing_opt_in,
  });
  if (error) {
    console.error('waitlist signup persistence failed', { code: error.code });
    return respond({ code: 'WAITLIST_UNAVAILABLE' }, 503);
  }
  return respond({ saved: true });
});
