import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';

const equal = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = Deno.env.get('MOVA_JOB_DISPATCH_SECRET');
  if (!secret || !equal(request.headers.get('x-mova-job-secret') ?? '', secret)) return respond({ code: 'UNAUTHENTICATED' }, 401);

  const body = await request.json().catch(() => ({}));
  const limit = Number.isInteger(body?.limit) ? body.limit as number : 100;
  if (limit < 1 || limit > 500) return respond({ code: 'JOB_LIMIT_INVALID' }, 422);

  try {
    const { data, error } = await serviceClient().rpc('mova_dispatch_outbox_events', { p_limit: limit });
    if (error) return respond({ code: 'JOB_DISPATCH_FAILED' }, 503);
    return respond({ enqueued: data });
  } catch {
    return respond({ code: 'JOB_DISPATCH_FAILED' }, 503);
  }
});
