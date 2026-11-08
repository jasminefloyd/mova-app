import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { corsHeaders } from '../_shared/cors.ts';

const maxBytes = 10 * 1024 * 1024;
const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const json = (data: unknown, status = 200) => Response.json({ data, error: null, request_id: crypto.randomUUID() }, { status, headers: corsHeaders });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ code: 'AUTH_REQUIRED' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ code: 'SERVER_CONFIGURATION_MISSING' }, 500);

  const body = await request.json().catch(() => null);
  const kind = body?.kind;
  const size = Number(body?.size);
  const contentType = typeof body?.contentType === 'string' ? body.contentType.toLowerCase() : '';
  if (!['profile', 'cover', 'portfolio', 'visit'].includes(kind) || !Number.isFinite(size) || size <= 0 || size > maxBytes || !allowedMime.has(contentType)) {
    return json({ code: 'INVALID_UPLOAD' }, 422);
  }

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ code: 'AUTH_REQUIRED' }, 401);
  const { data: membership, error: membershipError } = await userClient.from('mova_artist_memberships')
    .select('artist_business_id').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle();
  if (membershipError || !membership) return json({ code: 'ARTIST_MEMBERSHIP_REQUIRED' }, 403);

  const bucket = kind === 'portfolio' ? 'mova_portfolio_media' : kind === 'visit' ? 'mova_visit_private' : 'mova_profile_photos';
  const path = `${membership.artist_business_id}/original/${crypto.randomUUID()}`;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (kind === 'visit') {
    const noteId = typeof body?.visitNoteId === 'string' ? body.visitNoteId : '';
    const { data: note } = await admin.from('mova_visit_notes').select('id').eq('id', noteId).eq('artist_business_id', membership.artist_business_id).maybeSingle();
    if (!note) return json({ code: 'VISIT_NOTE_NOT_FOUND' }, 404);
  }
  const { data: signedUpload, error: signedUploadError } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (signedUploadError || !signedUpload) return json({ code: 'UPLOAD_URL_FAILED' }, 500);
  return json({ uploadUrl: signedUpload.signedUrl, token: signedUpload.token, path, bucket });
});
