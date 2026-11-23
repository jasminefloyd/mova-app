import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { closureBilling, closureSignature, uuidPattern } from '../_shared/account-closure.ts';
import { sameSecret } from '../_shared/admin-secret.ts';

const reasons = new Set(['cost', 'features', 'switching', 'no_longer_needed', 'other']);
const failure = (code: string, status = 409) => respond({ code }, status);

Deno.serve(withSystemRequestLogging('privacy-management', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return failure('ACTION_INVALID', 422);
  const db = serviceClient();
  try {
    if (body.action === 'feedback' || body.action === 'reactivate') {
      const [id, business, signature, extra] = typeof body.token === 'string' ? body.token.split('.') : [];
      const secret = Deno.env.get('MOVA_JOB_DISPATCH_SECRET');
      if (!id || !business || extra !== undefined || !uuidPattern.test(id) || !uuidPattern.test(business) || !secret ||
        !sameSecret(signature ?? null, await closureSignature(id, business, secret))) return failure('LINK_UNAVAILABLE', 404);
      if (body.action === 'reactivate') {
        const { data, error } = await db.rpc('mova_account_restore', { p_business: business, p_closure: id });
        if (error) throw error;
        return data ? respond({ restored: true }) : failure('LINK_UNAVAILABLE', 404);
      }
      const reason = typeof body.reason === 'string' && reasons.has(body.reason) ? body.reason : null;
      const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
      if ((!reason && !comment) || comment.length > 2000) return failure('INVALID_FEEDBACK', 422);
      const { data, error } = await db.from('mova_account_closures').update({ feedback: comment || null, feedback_reason: reason })
        .eq('id', id).eq('artist_business_id', business).eq('source', 'stylist').eq('state', 'archived').select('id').maybeSingle();
      if (error) throw error;
      return data ? respond({ saved: true }) : failure('LINK_UNAVAILABLE', 404);
    }

    if (body.action === 'preview_delete' || body.action === 'request_delete') {
      const actor = await artistClient(request);
      if (!actor) return failure('UNAUTHENTICATED', 401);
      const { data: owner, error } = await db.rpc('mova_account_owner', { p_business: actor.businessId });
      if (error) throw error;
      if (owner !== actor.user.id) return failure('ACCOUNT_OWNER_REQUIRED', 403);
      const { data: existing, error: lookup } = await db.from('mova_account_closures').select('state,ends_at').eq('artist_business_id', actor.businessId).maybeSingle();
      if (lookup) throw lookup;
      if (existing) return respond(existing);
      const { endsAt } = await closureBilling(db, actor.businessId, body.action === 'request_delete' ? 'stop_renewal' : 'none');
      if (body.action === 'preview_delete') return respond({ state: 'active', ends_at: endsAt });
      const { data, error: saveError } = await db.rpc('mova_account_begin', {
        p_business: actor.businessId, p_actor: actor.user.id, p_source: 'stylist', p_ends_at: endsAt,
      });
      if (saveError) throw saveError;
      return respond(data);
    }

    if (!['archive', 'restore', 'delete'].includes(body.action) || typeof body.business_id !== 'string' || !uuidPattern.test(body.business_id)) return failure('ACTION_INVALID', 422);
    const business = body.business_id;
    const authorization = request.headers.get('Authorization');
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!authorization || !url || !anon) return failure('UNAUTHENTICATED', 401);
    const client = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: { user } } = await client.auth.getUser();
    const { data: isAdmin } = await client.rpc('mova_is_platform_admin');
    if (!user || isAdmin !== true) return failure('PLATFORM_ADMIN_REQUIRED', 403);

    if (body.action === 'restore') {
      const { data, error } = await client.rpc('mova_admin_restore_account', { p_business: business });
      if (error) throw error;
      return data ? respond({ restored: true }) : failure('ACCOUNT_NOT_ARCHIVED');
    }
    if (body.action === 'archive') {
      const { error: ownerError } = await db.rpc('mova_account_owner', { p_business: business });
      if (ownerError) throw ownerError;
      await closureBilling(db, business, 'stop_renewal');
      const { data, error } = await db.rpc('mova_account_begin', { p_business: business, p_actor: user.id, p_source: 'admin', p_ends_at: null });
      if (error) throw error;
      return respond(data);
    }

    if (typeof body.display_name !== 'string' || body.confirm_delete_forever !== true) return failure('DELETE_CONFIRMATION_REQUIRED', 422);
    const { error: prepareError } = await db.rpc('mova_account_prepare_purge', { p_business: business, p_admin: user.id, p_name: body.display_name });
    if (prepareError) throw prepareError;
    await closureBilling(db, business, 'cancel');
    for (;;) {
      const { data: files, error } = await db.rpc('mova_account_storage', { p_business: business });
      if (error) throw error;
      if (!files?.length) break;
      const byBucket = new Map<string, string[]>();
      for (const file of files as { bucket_id: string; name: string }[]) {
        const paths = byBucket.get(file.bucket_id) ?? [];
        paths.push(file.name);
        byBucket.set(file.bucket_id, paths);
      }
      for (const [bucket, paths] of byBucket) {
        const { error: removalError } = await db.storage.from(bucket).remove(paths);
        if (removalError) throw new Error('ACCOUNT_MEDIA_DELETE_FAILED');
      }
    }
    const { error: purgeError } = await db.rpc('mova_account_purge', { p_business: business, p_admin: user.id });
    if (purgeError) throw purgeError;
    return respond({ deleted: true });
  } catch (error) {
    const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
    const known = /^(ACCOUNT_[A-Z_]+|BILLING_[A-Z_]+|STRIPE_[A-Z_]+|DISPLAY_NAME_MISMATCH|BUSINESS_NOT_FOUND|PLATFORM_ADMIN_REQUIRED)$/.test(message);
    console.error('Account closure operation failed', { action: body.action, code: known ? message : 'ACCOUNT_OPERATION_FAILED' });
    return failure(known ? message : 'ACCOUNT_OPERATION_FAILED');
  }
}));
