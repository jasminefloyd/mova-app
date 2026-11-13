import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { ImageMagick, initializeImageMagick, MagickFormat, Gravity } from 'npm:@imagemagick/magick-wasm@0.0.44';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import { corsHeaders } from '../_shared/cors.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';

const wasmModule = 'npm:@imagemagick/magick-wasm@0.0.44';
const wasmBytes = await Deno.readFile(new URL('magick.wasm', import.meta.resolve(wasmModule)));
await initializeImageMagick(wasmBytes);

const json = (data: unknown, status = 200) => Response.json({ data, error: null, request_id: crypto.randomUUID() }, { status, headers: corsHeaders });

function supportedImage(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 8 && bytes[0] === 0x89 && new TextDecoder().decode(bytes.slice(1, 4)) === 'PNG') return true;
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return true;
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp') {
    const brand = new TextDecoder().decode(bytes.slice(8, 12));
    return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
  }
  return false;
}

Deno.serve(withSystemRequestLogging('photo-process', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ code: 'AUTH_REQUIRED' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ code: 'SERVER_CONFIGURATION_MISSING' }, 500);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ code: 'AUTH_REQUIRED' }, 401);
  const body = await request.json().catch(() => null);
  const path = typeof body?.path === 'string' ? body.path : '';
  const kind = body?.kind;
  const zoom = Number(body?.zoom ?? 1);
  if (!['profile', 'cover', 'portfolio', 'visit'].includes(kind) || !Number.isFinite(zoom) || zoom < 1 || zoom > 2) return json({ code: 'INVALID_REQUEST' }, 422);
  if (!path || path.split('/').length !== 3 || path.split('/')[1] !== 'original') return json({ code: 'INVALID_PATH' }, 422);

  const { data: membership } = await userClient.from('mova_artist_memberships').select('artist_business_id,role')
    .eq('user_id', user.id).eq('artist_business_id', path.split('/')[0]).eq('status', 'active').maybeSingle();
  if (!membership) return json({ code: 'ARTIST_MEMBERSHIP_REQUIRED' }, 403);
  if (kind === 'cover' && !await planFeatureEnabled(membership.artist_business_id, 'custom_cover')) return json({ code: 'PLAN_FEATURE_NOT_INCLUDED', feature: 'custom_cover' }, 403);
  if ((kind === 'profile' || kind === 'cover') && membership.role !== 'owner') return json({ code: 'OWNER_PROFILE_REQUIRED' }, 403);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = kind === 'portfolio' ? 'mova_portfolio_media' : kind === 'visit' ? 'mova_visit_private' : 'mova_profile_photos';
  const visitNoteId = typeof body?.visit_note_id === 'string' ? body.visit_note_id : '';
  const visitMediaKind = body?.media_kind === 'after' ? 'after' : body?.media_kind === 'before' ? 'before' : null;
  let visitNote: { id: string; client_id: string } | null = null;
  if (kind === 'visit') {
    if (!visitNoteId || !visitMediaKind) return json({ code: 'VISIT_MEDIA_CONTEXT_REQUIRED' }, 422);
    const { data } = await admin.from('mova_visit_notes').select('id,client_id').eq('id', visitNoteId).eq('artist_business_id', membership.artist_business_id).maybeSingle();
    if (!data) return json({ code: 'VISIT_NOTE_NOT_FOUND' }, 404);
    visitNote = data;
  }
  const { data: original, error: downloadError } = await admin.storage.from(bucket).download(path);
  if (downloadError || !original) return json({ code: 'UPLOAD_NOT_FOUND' }, 404);
  if (original.size > 10 * 1024 * 1024) return json({ code: 'FILE_SIZE_INVALID' }, 422);

  const uploadedPaths: string[] = [];
  try {
    const input = new Uint8Array(await original.arrayBuffer());
    if (!supportedImage(input)) {
      await admin.storage.from(bucket).remove([path]);
      return json({ code: 'FILE_TYPE_INVALID' }, 422);
    }
    const outputs = await ImageMagick.read(input, async (image) => {
      for (const profile of [...image.profileNames]) image.removeProfile(profile);
      for (const attribute of [...image.attributeNames]) image.removeAttribute(attribute);
      for (const artifact of [...image.artifactNames]) image.removeArtifact(artifact);
      image.comment = null;
      image.label = null;
      const square = Math.max(1, Math.floor(Math.min(image.width, image.height) / zoom));
      image.crop(square, square, Gravity.Center);
      image.resetPage();
      image.format = MagickFormat.Jpeg;
      image.quality = 84;
      image.resize(512, 512);
      const master = image.write(MagickFormat.Jpeg, (data) => data);
      if (kind === 'portfolio' || kind === 'visit') return { '512': master };
      const result: Record<string, Uint8Array> = { '512': master };
      for (const size of [96, 256]) {
        result[String(size)] = ImageMagick.read(master, (variant) => {
          variant.resize(size, size);
          variant.format = MagickFormat.Jpeg;
          variant.quality = 84;
          return variant.write(MagickFormat.Jpeg, (data) => data);
        });
      }
      return result;
    });

    const version = crypto.randomUUID();
    const variants: Record<string, string> = {};
    for (const [size, bytes] of Object.entries(outputs)) {
      const variantPath = kind === 'visit'
        ? `${membership.artist_business_id}/visits/${visitNoteId}/${visitMediaKind}-${version}.jpg`
        : `${membership.artist_business_id}/variants/${version}-${size}.jpg`;
      const { error: storeError } = await admin.storage.from(bucket).upload(variantPath, bytes, { contentType: 'image/jpeg', upsert: false });
      if (storeError) throw storeError;
      uploadedPaths.push(variantPath);
      variants[size] = variantPath;
    }
    const { error: deleteError } = await admin.storage.from(bucket).remove([path]);
    if (deleteError) throw deleteError;

    if (kind === 'visit' && visitNote) {
      const { error: recordError } = await admin.from('mova_visit_note_media').insert({ artist_business_id: membership.artist_business_id, client_id: visitNote.client_id, visit_note_id: visitNote.id, kind: visitMediaKind, storage_path: variants['512'], content_type: 'image/jpeg' });
      if (recordError) throw recordError;
    }

    if (kind === 'profile' || kind === 'cover') {
      const { data: existingProfile } = await admin.from('mova_artist_profiles').select('photo_variants')
        .eq('artist_business_id', membership.artist_business_id).maybeSingle();
      const existingVariants = existingProfile?.photo_variants && typeof existingProfile.photo_variants === 'object'
        ? existingProfile.photo_variants as Record<string, unknown> : {};
      const oldVariantGroup = existingVariants[kind];
      const oldPaths = oldVariantGroup && typeof oldVariantGroup === 'object'
        ? Object.values(oldVariantGroup as Record<string, unknown>).filter((oldPath): oldPath is string => typeof oldPath === 'string')
        : [];
      const { error: updateError } = await admin.from('mova_artist_profiles').update({
        [kind === 'profile' ? 'profile_photo_path' : 'cover_photo_path']: variants['512'],
        photo_variants: { ...existingVariants, [kind]: variants },
        photo_updated_at: new Date().toISOString(),
      }).eq('artist_business_id', membership.artist_business_id);
      if (updateError) throw updateError;
      const replacedPaths = oldPaths.filter((oldPath) => !Object.values(variants).includes(oldPath));
      if (replacedPaths.length) await admin.storage.from(bucket).remove(replacedPaths);
    }
    return json({ variants, kind });
  } catch {
    if (uploadedPaths.length) await admin.storage.from(bucket).remove(uploadedPaths);
    await admin.storage.from(bucket).remove([path]);
    return json({ code: 'IMAGE_PROCESSING_FAILED' }, 422);
  }
}));
