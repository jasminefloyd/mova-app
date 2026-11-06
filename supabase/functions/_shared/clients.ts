import { artistClient, corsHeaders, respond, serviceClient } from './booking.ts';

type Auth = NonNullable<Awaited<ReturnType<typeof artistClient>>>;
const fail = (code: string, status = 400) => respond({ code }, status);
const clean = (v: unknown, max = 1000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const normalizeEmail = (v: unknown) => clean(v, 320).toLowerCase() || null;
const normalizePhone = (v: unknown) => { const d = clean(v, 40).replace(/\D/g, ''); return d ? (d.length === 10 ? `1${d}` : d) : null; };
const locale = (v: unknown) => v === 'es-US' ? 'es-US' : 'en-US';
async function auth(request: Request): Promise<Auth | null> { return await artistClient(request); }
function cryptoKey() {
  const hex = Deno.env.get('MOVA_NOTES_KEK_HEX') ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('NOTES_ENCRYPTION_KEY_MISSING');
  return crypto.subtle.importKey('raw', new Uint8Array(hex.match(/.{2}/g)!.map((v) => parseInt(v, 16))), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encrypt(value: string, aad: string) {
  const key = await cryptoKey(), dataKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const dataKey = await crypto.subtle.importKey('raw', dataKeyBytes, { name: 'AES-GCM' }, false, ['encrypt','decrypt']);
  const dataIv = crypto.getRandomValues(new Uint8Array(12)), wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const [ciphertext, wrappedKey] = await Promise.all([
    crypto.subtle.encrypt({ name: 'AES-GCM', iv: dataIv, additionalData: new TextEncoder().encode(aad) }, dataKey, new TextEncoder().encode(value)),
    crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv, additionalData: new TextEncoder().encode(`${aad}:dek`) }, key, dataKeyBytes),
  ]);
  const record = { version: 1, data_iv: btoa(String.fromCharCode(...dataIv)), wrapped_key_iv: btoa(String.fromCharCode(...wrapIv)), wrapped_key: btoa(String.fromCharCode(...new Uint8Array(wrappedKey))), ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))) };
  return { ciphertext: btoa(JSON.stringify(record)), version: 'v1' };
}
async function decrypt(value: string, aad: string) {
  const record=JSON.parse(atob(value)) as {version:number;data_iv:string;wrapped_key_iv:string;wrapped_key:string;ciphertext:string};if(record.version!==1)throw new Error('NOTES_CIPHERTEXT_VERSION_UNSUPPORTED');
  const wrapIv=Uint8Array.from(atob(record.wrapped_key_iv),(c)=>c.charCodeAt(0)),wrappedKey=Uint8Array.from(atob(record.wrapped_key),(c)=>c.charCodeAt(0));
  const rawDataKey=await crypto.subtle.decrypt({name:'AES-GCM',iv:wrapIv,additionalData:new TextEncoder().encode(`${aad}:dek`)},await cryptoKey(),wrappedKey);
  const dataKey=await crypto.subtle.importKey('raw',rawDataKey,{name:'AES-GCM'},false,['decrypt']);
  const dataIv=Uint8Array.from(atob(record.data_iv),(c)=>c.charCodeAt(0)),ciphertext=Uint8Array.from(atob(record.ciphertext),(c)=>c.charCodeAt(0));
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv:dataIv, additionalData: new TextEncoder().encode(aad) }, dataKey, ciphertext);
  return new TextDecoder().decode(clear);
}
async function send(request: Request, operation: (a: Auth, body: Record<string, unknown>) => Promise<unknown>) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  const actor = await auth(request); if (!actor) return fail('UNAUTHENTICATED', 401);
  let body: Record<string, unknown>; try { body = await request.json(); } catch { return fail('INVALID_JSON'); }
  try { return respond(await operation(actor, body)); } catch (e) { return fail(e instanceof Error ? e.message : 'REQUEST_FAILED', 400); }
}

export async function clientsEndpoint(request: Request) {
  return send(request, async ({ businessId, user }, body) => {
    const db = serviceClient(); const action = clean(body.action, 32);
    if (action === 'list') {
      const { data, error } = await db.from('mova_clients').select('id,client_number,display_name,email,phone,preferred_locale,source,marketing_opted_out,last_visit_at,visit_count,created_at').eq('artist_business_id', businessId).order('display_name').limit(500);
      if (error) throw new Error('CLIENT_LIST_FAILED'); const search = clean(body.search, 100).toLowerCase();
      return (data ?? []).filter((c: Record<string, unknown>) => !search || [c.display_name,c.email,c.phone].some((v) => String(v ?? '').toLowerCase().includes(search)));
    }
    if (action === 'create') {
      const name = clean(body.display_name, 160), email = clean(body.email, 320), phone = clean(body.phone, 40);
      if (!name || (!email && !phone)) throw new Error('CLIENT_NAME_AND_CONTACT_REQUIRED');
      const { data, error } = await db.from('mova_clients').insert({ artist_business_id: businessId, display_name: name, email: email || null, email_normalized: normalizeEmail(email), phone: phone || null, phone_normalized: normalizePhone(phone), preferred_locale: locale(body.preferred_locale), created_by: user.id }).select('id,client_number,display_name,email,phone,preferred_locale').single();
      if (error) throw new Error('CLIENT_CREATE_FAILED'); return data;
    }
    if (action === 'update') {
      const id = clean(body.client_id, 64); const patch: Record<string, unknown> = {};
      if (typeof body.display_name === 'string') patch.display_name = clean(body.display_name, 160);
      if (typeof body.email === 'string') { patch.email = clean(body.email, 320) || null; patch.email_normalized = normalizeEmail(body.email); }
      if (typeof body.phone === 'string') { patch.phone = clean(body.phone, 40) || null; patch.phone_normalized = normalizePhone(body.phone); }
      if (body.preferred_locale) patch.preferred_locale = locale(body.preferred_locale);
      if (!id || !Object.keys(patch).length) throw new Error('CLIENT_UPDATE_INVALID');
      const { data, error } = await db.from('mova_clients').update(patch).eq('id', id).eq('artist_business_id', businessId).select('id,client_number,display_name,email,phone,preferred_locale').maybeSingle();
      if (error || !data) throw new Error('CLIENT_UPDATE_FAILED'); return data;
    }
    if (action === 'visits') {
      const id=clean(body.client_id,64);const {data:appointments,error}=await db.from('mova_appointments').select('id,appointment_number,starts_at,status,service_name_snapshot,service_price_minor,location_id,mova_locations(name,time_zone)').eq('artist_business_id',businessId).eq('client_id',id).order('starts_at',{ascending:false}).limit(100);if(error)throw new Error('CLIENT_VISITS_FAILED');
      const ids=(appointments??[]).map((a:Record<string,unknown>)=>a.id);if(!ids.length)return[];
      const [{data:notes},{data:media}]=await Promise.all([db.from('mova_visit_notes').select('id,appointment_id,what_was_done').eq('artist_business_id',businessId).in('appointment_id',ids),db.from('mova_visit_note_media').select('visit_note_id').eq('artist_business_id',businessId).eq('client_id',id)]);
      const noteByAppointment=new Map((notes??[]).map((n:Record<string,unknown>)=>[n.appointment_id,n]));
      const mediaCounts=new Map<string,number>();for(const m of media??[])mediaCounts.set(String(m.visit_note_id),(mediaCounts.get(String(m.visit_note_id))??0)+1);
      return (appointments??[]).map((a:Record<string,unknown>)=>{const note=noteByAppointment.get(a.id) as Record<string,unknown>|undefined;return{...a,note_summary:note?.what_was_done??'',photo_count:note?mediaCounts.get(String(note.id))??0:0};});
    }
    if (action === 'delete') {
      const id = clean(body.client_id, 64); if (!id) throw new Error('CLIENT_ID_REQUIRED');
      const { data: media } = await db.from('mova_visit_note_media').select('storage_path').eq('artist_business_id', businessId).eq('client_id', id);
      if (media?.length) { const { error: removalError } = await db.storage.from('mova_visit_private').remove(media.map((r: { storage_path: string }) => r.storage_path)); if (removalError) throw new Error('CLIENT_MEDIA_DELETE_FAILED'); }
      const { error } = await db.from('mova_clients').delete().eq('id', id).eq('artist_business_id', businessId); if (error) throw new Error('CLIENT_DELETE_FAILED'); return { deleted: true };
    }
    if (action === 'export') {
      const id = clean(body.client_id, 64); const { data: client, error } = await db.from('mova_clients').select('*').eq('id', id).eq('artist_business_id', businessId).single();
      if (error || !client) throw new Error('CLIENT_NOT_FOUND');
      const [{ data: notes }, { data: visits }, { data: consents }, { data: history }, { data: media }] = await Promise.all([
        db.from('mova_client_notes').select('*').eq('artist_business_id', businessId).eq('client_id', id),
        db.from('mova_visit_notes').select('*').eq('artist_business_id', businessId).eq('client_id', id),
        db.from('mova_client_consents').select('*').eq('artist_business_id', businessId).eq('client_id', id),
        db.from('mova_client_note_history').select('*').eq('artist_business_id', businessId).eq('client_id', id),
        db.from('mova_visit_note_media').select('id,visit_note_id,kind,content_type,created_at,storage_path').eq('artist_business_id', businessId).eq('client_id', id),
      ]);
      const exportedNotes = await Promise.all((notes ?? []).map(async (n: Record<string, unknown>) => ({ ...n, body: n.is_sensitive ? await decrypt(String(n.sensitive_ciphertext), `${businessId}:${id}:${n.id}`) : n.body, sensitive_ciphertext: undefined })));
      const exportedHistory = await Promise.all((history ?? []).map(async (n: Record<string, unknown>) => ({ ...n, body: n.is_sensitive ? await decrypt(String(n.sensitive_ciphertext), `${businessId}:${id}:${n.note_id}`) : n.body, sensitive_ciphertext: undefined })));
      const exportedMedia = await Promise.all((media ?? []).map(async (m:Record<string,unknown>)=>{const {data:signed,error:signError}=await db.storage.from('mova_visit_private').createSignedUrl(String(m.storage_path),3600);if(signError)throw new Error('CLIENT_EXPORT_MEDIA_FAILED');return{id:m.id,visit_note_id:m.visit_note_id,kind:m.kind,content_type:m.content_type,created_at:m.created_at,download_url:signed.signedUrl};}));
      return { client, notes: exportedNotes, note_history: exportedHistory, visits: visits ?? [], visit_media: exportedMedia, consents: consents ?? [] };
    }
    throw new Error('UNKNOWN_CLIENT_ACTION');
  });
}

export async function consentsEndpoint(request: Request) {
  return send(request, async ({ businessId, user }, body) => {
    const db = serviceClient(); const id = clean(body.client_id, 64);
    if (body.action === 'opt_out_all' && id) { const { error } = await db.rpc('mova_set_client_marketing_opt_out', { p_artist_business_id:businessId,p_client_id:id,p_opted_out:true,p_locale:locale(body.locale),p_actor_id:user.id }); if (error) throw new Error('CONSENT_SAVE_FAILED'); return { opted_out:true }; }
    if (body.action === 'list') { const { data, error } = await db.from('mova_client_consents').select('id,purpose,channel,granted,locale,evidence,changed_at').eq('artist_business_id', businessId).eq('client_id', id).order('changed_at', { ascending: false }); if (error) throw new Error('CONSENT_LIST_FAILED'); return data; }
    if (body.action !== 'set' || !id || !['appointment_updates','rebooking_reminders','offers','review_requests'].includes(String(body.purpose)) || !['sms','email','instagram','push'].includes(String(body.channel)) || typeof body.granted !== 'boolean') throw new Error('CONSENT_INPUT_INVALID');
    const purpose = String(body.purpose), channel = String(body.channel), granted = Boolean(body.granted), loc = locale(body.locale);
    const { error } = await db.from('mova_client_consents').insert({ artist_business_id: businessId, client_id: id, purpose, channel, granted, locale: loc, evidence: { source: 'artist_explicit_action', version: 'p07-v1' }, changed_by: user.id });
    if (error) throw new Error('CONSENT_SAVE_FAILED');
    if (granted && purpose !== 'appointment_updates') await db.from('mova_clients').update({ marketing_opted_out:false }).eq('id',id).eq('artist_business_id',businessId);
    return { saved: true };
  });
}

export async function importEndpoint(request: Request) {
  return send(request, async ({ businessId, user }, body) => {
    const db = serviceClient(); const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : []; if (!rows.length) throw new Error('IMPORT_ROWS_INVALID');
    const { data: clients, error } = await db.from('mova_clients').select('id,display_name,email_normalized,phone_normalized').eq('artist_business_id', businessId);
    if (error) throw new Error('IMPORT_PREVIEW_FAILED');
    const preview = rows.map((raw, index) => {
      const row = raw as Record<string, unknown>; const email = normalizeEmail(row.email), phone = normalizePhone(row.phone);
      const matches = (clients ?? []).filter((c: Record<string, unknown>) => (email && c.email_normalized === email) || (phone && c.phone_normalized === phone));
      return { index, name: clean(row.name ?? row.display_name,160), email, phone, match_count: matches.length, matches, decision: matches.length === 1 ? 'merge' : matches.length > 1 ? null : 'new' };
    });
    if (body.action === 'preview') return { preview, counts: { rows: preview.length, new: preview.filter((x) => !x.match_count).length, exact: preview.filter((x) => x.match_count === 1).length, need_review: preview.filter((x) => x.match_count > 1).length } };
    if (body.action !== 'commit') throw new Error('IMPORT_ACTION_INVALID');
    const key = clean(request.headers.get('Idempotency-Key') ?? body.idempotency_key, 200); if (key.length < 8) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    const commitRows = rows.map((raw, index) => { const row = raw as Record<string, unknown>, p = preview[index], decision = clean(row.decision ?? p.decision, 16); return { name: p.name, email: clean(row.email,320) || null, email_normalized: p.email, phone: clean(row.phone,40) || null, phone_normalized: p.phone, preferred_locale: locale(row.preferred_locale), decision: decision === 'keep_both' ? 'keep_both' : decision === 'merge' && p.match_count === 1 ? 'merge' : decision === 'new' ? 'new' : null, target_client_id: decision === 'merge' && p.match_count === 1 ? p.matches[0].id : clean(row.target_client_id,64) || null }; });
    if (commitRows.some((r) => !r.name || !r.decision || (r.decision === 'merge' && !r.target_client_id))) throw new Error('IMPORT_DECISIONS_REQUIRED');
    const payloadHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(commitRows))); const hashHex = [...new Uint8Array(payloadHash)].map((b) => b.toString(16).padStart(2,'0')).join('');
    const { data, error: rpcError } = await db.rpc('mova_client_import_commit', { p_artist_business_id: businessId, p_actor_id: user.id, p_idempotency_key: key, p_payload_hash_hex: hashHex, p_rows: commitRows });
    if (rpcError) throw new Error('IMPORT_COMMIT_FAILED'); return data;
  });
}

export async function notesEndpoint(request: Request) {
  return send(request, async ({ businessId, user }, body) => {
    const db = serviceClient(), action = clean(body.action, 20), clientId = clean(body.client_id, 64);
    if (action === 'list') { const { data, error } = await db.from('mova_client_notes').select('*').eq('artist_business_id', businessId).eq('client_id', clientId).order('updated_at', { ascending: false }); if (error) throw new Error('NOTES_LIST_FAILED'); return await Promise.all((data ?? []).map(async (n: Record<string, unknown>) => ({ ...n, body: n.is_sensitive ? await decrypt(String(n.sensitive_ciphertext), `${businessId}:${clientId}:${n.id}`) : n.body, sensitive_ciphertext: undefined }))); }
    if (action === 'save') {
      const existingId = clean(body.id,64), id = existingId || crypto.randomUUID(), category = clean(body.category,24), text = clean(body.body,10000); if (!clientId || !text || !['hair','color','products','preferences','personal','free'].includes(category)) throw new Error('NOTE_INPUT_INVALID');
      const isSensitive = Boolean(body.is_sensitive); const encrypted = isSensitive ? await encrypt(text, `${businessId}:${clientId}:${id}`) : null;
      const values: Record<string, unknown> = { id, artist_business_id: businessId, client_id: clientId, category, body: isSensitive ? '' : text, sensitive_ciphertext: encrypted ? encrypted.ciphertext : null, sensitive_key_version: encrypted?.version ?? null, is_sensitive: isSensitive, is_pinned: Boolean(body.is_pinned), show_next_visit: Boolean(body.show_next_visit), created_by: user.id };
      if (body.show_next_visit) { const { data: upcoming } = await db.from('mova_appointments').select('id').eq('artist_business_id',businessId).eq('client_id',clientId).in('status',['confirmed','pending_artist','pending_payment']).gt('starts_at',new Date().toISOString()).order('starts_at').limit(1).maybeSingle(); values.next_appointment_id = upcoming?.id ?? null; }
      if (existingId) {
        const { data: old, error: readError } = await db.from('mova_client_notes').select('*').eq('id',id).eq('artist_business_id',businessId).eq('client_id',clientId).single(); if (readError) throw new Error('NOTE_NOT_FOUND');
        const { error: histError } = await db.from('mova_client_note_history').insert({ artist_business_id: businessId,client_id: clientId,note_id:id,category:old.category,body:old.body,sensitive_ciphertext:old.sensitive_ciphertext,sensitive_key_version:old.sensitive_key_version,is_sensitive:old.is_sensitive,is_pinned:old.is_pinned,show_next_visit:old.show_next_visit,next_appointment_id:old.next_appointment_id,changed_by:user.id }); if (histError) throw new Error('NOTE_HISTORY_SAVE_FAILED');
        const patch = { ...values }; delete patch.id; delete patch.created_by;
        const { error } = await db.from('mova_client_notes').update(patch).eq('id',id).eq('artist_business_id',businessId).eq('client_id',clientId); if (error) throw new Error('NOTE_SAVE_FAILED'); return { id };
      }
      const { data, error } = await db.from('mova_client_notes').insert(values).select('id').single(); if (error) throw new Error('NOTE_SAVE_FAILED'); return data;
    }
    if (action === 'delete') { const { error } = await db.from('mova_client_notes').delete().eq('id',clean(body.id,64)).eq('artist_business_id',businessId).eq('client_id',clientId); if (error) throw new Error('NOTE_DELETE_FAILED'); return { deleted: true }; }
    throw new Error('NOTE_ACTION_INVALID');
  });
}

export async function visitNotesEndpoint(request: Request) {
  return send(request, async ({ businessId, user }, body) => {
    const db = serviceClient(), action = clean(body.action,24), appointmentId = clean(body.appointment_id,64), clientId = clean(body.client_id,64);
    const { data: appointment, error: aError } = await db.from('mova_appointments').select('id,client_id,artist_business_id,status,starts_at').eq('id',appointmentId).eq('artist_business_id',businessId).single();
    if (aError || !appointment || (clientId && appointment.client_id !== clientId)) throw new Error('APPOINTMENT_NOT_FOUND');
    if (action === 'get') { const { data, error } = await db.from('mova_visit_notes').select('*,mova_visit_note_media(id,kind,storage_path,content_type,created_at)').eq('appointment_id',appointmentId).eq('artist_business_id',businessId).maybeSingle(); if (error) throw new Error('VISIT_NOTE_LOAD_FAILED'); if(!data)return null; const media=await Promise.all((data.mova_visit_note_media??[]).map(async(m:Record<string,unknown>)=>{const{data:signed,error:signError}=await db.storage.from('mova_visit_private').createSignedUrl(String(m.storage_path),60);if(signError)throw new Error('VISIT_MEDIA_URL_FAILED');return{id:m.id,kind:m.kind,url:signed.signedUrl,created_at:m.created_at};}));return{...data,mova_visit_note_media:media}; }
    if (action !== 'save') throw new Error('VISIT_NOTE_ACTION_INVALID');
    const next = body.show_next_visit ? await db.from('mova_appointments').select('id').eq('artist_business_id',businessId).eq('client_id',appointment.client_id).in('status',['confirmed','pending_artist','pending_payment']).gt('starts_at',appointment.starts_at).order('starts_at').limit(1).maybeSingle() : { data: null, error: null };
    const values = { artist_business_id:businessId,client_id:appointment.client_id,appointment_id:appointmentId,what_was_done:clean(body.what_was_done,10000),products_settings:Array.isArray(body.products_settings)?body.products_settings.slice(0,50):[],for_next_time:clean(body.for_next_time,5000),show_next_visit:Boolean(body.show_next_visit),next_appointment_id:next.data?.id??null,created_by:user.id };
    const { data, error } = await db.from('mova_visit_notes').upsert(values,{onConflict:'appointment_id'}).select('id').single(); if (error) throw new Error('VISIT_NOTE_SAVE_FAILED'); return data;
  });
}

export async function beforeYouStartEndpoint(request: Request) {
  return send(request, async ({ businessId }, body) => {
    const db=serviceClient(), appointmentId=clean(body.appointment_id,64);
    const {data:appointment,error}=await db.from('mova_appointments').select('id,artist_business_id,client_id,starts_at').eq('id',appointmentId).eq('artist_business_id',businessId).single();
    if(error||!appointment||!appointment.client_id)throw new Error('APPOINTMENT_NOT_FOUND');
    const [{data:pinned},{data:generalNext},{data:visitNext}]=await Promise.all([
      db.from('mova_client_notes').select('id,category,body,sensitive_ciphertext,sensitive_key_version,is_sensitive,is_pinned').eq('artist_business_id',businessId).eq('client_id',appointment.client_id).eq('is_pinned',true),
      db.from('mova_client_notes').select('id,category,body,sensitive_ciphertext,sensitive_key_version,is_sensitive,is_pinned').eq('artist_business_id',businessId).eq('client_id',appointment.client_id).eq('next_appointment_id',appointmentId).eq('show_next_visit',true),
      db.from('mova_visit_notes').select('id,for_next_time').eq('artist_business_id',businessId).eq('client_id',appointment.client_id).eq('next_appointment_id',appointmentId).eq('show_next_visit',true),
    ]);
    const privateNotes=await Promise.all([...(pinned??[]),...(generalNext??[])].map(async(n:Record<string,unknown>)=>({id:n.id,category:n.category,body:n.is_sensitive?await decrypt(String(n.sensitive_ciphertext),`${businessId}:${appointment.client_id}:${n.id}`):n.body,is_pinned:n.is_pinned})));
    return {notes:privateNotes,for_next_time:(visitNext??[]).map((n:Record<string,unknown>)=>n.for_next_time)};
  });
}
