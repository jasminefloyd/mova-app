import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { sameSecret } from '../_shared/admin-secret.ts';

// O2 (2026-11-08): super admin waitlist actions (list, approve, decline, resend). Until the admin portal
// exists it is called with the admin secret only: x-mova-admin-secret must equal MOVA_ADMIN_API_SECRET
// (at least 32 characters; missing or short fails closed). Never call it from a browser.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!sameSecret(request.headers.get('x-mova-admin-secret'), Deno.env.get('MOVA_ADMIN_API_SECRET'))) return respond({ code: 'UNAUTHORIZED' }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const db = serviceClient();
  const ids = Array.isArray(body?.signup_ids) ? body.signup_ids : [];
  const validIds = ids.length > 0 && ids.length <= 50 && ids.every((id) => typeof id === 'string' && uuid.test(id));
  switch (body?.action) {
    case 'list': {
      const { data, error } = await db.rpc('mova_waitlist_admin_list');
      return error ? respond({ code: 'WAITLIST_READ_FAILED' }, 500) : respond(data);
    }
    case 'approve': {
      if (!validIds) return respond({ code: 'INVALID_REQUEST' }, 422);
      const { data, error } = await db.rpc('mova_waitlist_approve', { p_signup_ids: ids });
      if (error?.message?.includes('EARLY_ACCESS_CAP_REACHED')) return respond({ code: 'EARLY_ACCESS_CAP_REACHED' }, 409);
      return error ? respond({ code: 'WAITLIST_APPROVE_FAILED' }, 500) : respond(data);
    }
    case 'decline': {
      if (!validIds) return respond({ code: 'INVALID_REQUEST' }, 422);
      const { data, error } = await db.rpc('mova_waitlist_decline', { p_signup_ids: ids });
      return error ? respond({ code: 'WAITLIST_DECLINE_FAILED' }, 500) : respond({ declined: data });
    }
    case 'resend': {
      if (!validIds || ids.length !== 1) return respond({ code: 'INVALID_REQUEST' }, 422);
      const { data, error } = await db.rpc('mova_waitlist_resend_invite', { p_signup_id: ids[0] });
      if (error) return respond({ code: 'WAITLIST_RESEND_FAILED' }, 500);
      return data === true ? respond({ queued: true }) : respond({ code: 'INVITE_NOT_RESENDABLE' }, 409);
    }
    default:
      return respond({ code: 'INVALID_ACTION' }, 422);
  }
});
