import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';

const tenantTables = [
  'mova_artist_memberships','mova_onboarding_progress','mova_artist_profiles','mova_services','mova_service_locations','mova_portfolio_items','mova_portfolio_service_links',
  'mova_locations','mova_location_hours','mova_location_exceptions','mova_location_policies','mova_availability_blocks','mova_appointments','mova_appointment_events',
  'mova_clients','mova_client_consents','mova_client_import_batches','mova_client_link_suggestions','mova_client_notes','mova_client_note_history','mova_visit_notes','mova_visit_note_media',
  'mova_payment_method_settings','mova_payments','mova_payment_ledger','mova_payment_refunds','mova_paylinks','mova_message_templates','mova_messages','mova_suppressions',
  'mova_notification_inbox','mova_autopilot_settings','mova_autopilot_decisions','mova_growth_opportunities','mova_slot_events','mova_slot_candidates','mova_slot_campaign_copy',
  'mova_concierge_settings','mova_concierge_knowledge','mova_conversations','mova_concierge_turns','mova_handoffs','mova_quote_requests','mova_reviews','mova_review_reports',
  'mova_review_settings','mova_review_requests','mova_google_reviews','mova_reports_daily_rollups','mova_profile_traffic_events','mova_social_share_events','mova_forecasts',
  'mova_business_plan_assignments','mova_usage_meter_events','mova_notification_preferences','mova_privacy_requests','mova_security_audit_events'
];
function decodeBase64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
async function decryptDoorCode(value: string) {
  const keyHex = Deno.env.get('MOVA_DOOR_CODE_KEK_HEX') ?? '';
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('DOOR_CODE_KEY_MISSING');
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  const bytes = new Uint8Array(hex.match(/.{2}/g)?.map((part) => parseInt(part, 16)) ?? []);
  if (bytes.length < 29) throw new Error('DOOR_CODE_CIPHERTEXT_INVALID');
  const key = await crypto.subtle.importKey('raw', new Uint8Array(keyHex.match(/.{2}/g)!.map((part) => parseInt(part, 16))), { name: 'AES-GCM' }, false, ['decrypt']);
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))); }
  catch { throw new Error('DOOR_CODE_DECRYPT_FAILED'); }
}
async function decryptNote(value: string, aad: string) {
  const hex = Deno.env.get('MOVA_NOTES_KEK_HEX') ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('NOTES_ENCRYPTION_KEY_MISSING');
  const record = JSON.parse(atob(value)) as { version: number; data_iv: string; wrapped_key_iv: string; wrapped_key: string; ciphertext: string };
  if (record.version !== 1) throw new Error('NOTES_CIPHERTEXT_VERSION_UNSUPPORTED');
  const key = await crypto.subtle.importKey('raw', new Uint8Array(hex.match(/.{2}/g)!.map((part) => parseInt(part, 16))), { name: 'AES-GCM' }, false, ['decrypt']);
  const dek = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(record.wrapped_key_iv), additionalData: new TextEncoder().encode(`${aad}:dek`) }, key, decodeBase64(record.wrapped_key));
  const dataKey = await crypto.subtle.importKey('raw', dek, { name: 'AES-GCM' }, false, ['decrypt']);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(record.data_iv), additionalData: new TextEncoder().encode(aad) }, dataKey, decodeBase64(record.ciphertext));
  return new TextDecoder().decode(clear);
}
async function fetchTenantRows(db: ReturnType<typeof serviceClient>, table: string, businessId: string, relatedIds: string[] = []) {
  const pageSize = 1000;
  const maxRows = 100_000;
  const rows: Record<string, unknown>[] = [];
  const orderBy: Record<string, string[]> = {
    mova_onboarding_progress: ['artist_business_id'],
    mova_payment_method_settings: ['artist_business_id'],
    mova_autopilot_settings: ['artist_business_id'],
    mova_concierge_settings: ['artist_business_id'],
    mova_review_settings: ['artist_business_id'],
    mova_reports_daily_rollups: ['local_date'],
    mova_business_plan_assignments: ['artist_business_id'],
    mova_notification_preferences: ['user_id'],
    mova_portfolio_service_links: ['portfolio_item_id', 'service_id'],
    mova_location_policies: ['location_id'],
  };
  const orderColumns = orderBy[table] ?? ['id'];
  if (['mova_service_locations', 'mova_portfolio_service_links'].includes(table) && relatedIds.length === 0) return rows;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    let query = db.from(table).select('*');
    if (table === 'mova_service_locations') query = query.in('service_id', relatedIds);
    else if (table === 'mova_portfolio_service_links') query = query.in('portfolio_item_id', relatedIds);
    else query = query.eq('artist_business_id', businessId);
    for (const column of orderColumns) query = query.order(column);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`EXPORT_READ_FAILED:${table}`);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error(`EXPORT_PAGE_LIMIT_REACHED:${table}`);
}
function redactSecrets(row: Record<string, unknown>) {
  const safe = { ...row };
  for (const key of Object.keys(safe)) if (/(^|_)(token|secret|ciphertext|encrypted|private_key|access_key|refresh_key)(_|$)/i.test(key)) delete safe[key];
  return safe;
}
Deno.serve(withSystemRequestLogging('artist-data-export', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const db = serviceClient();
  const payload: Record<string, unknown> = { schema_version: 1, exported_at: new Date().toISOString(), tenant_id: actor.businessId, tables: {} };
  const output = payload.tables as Record<string, unknown[]>;
  try {
    const { data: business, error: businessError } = await db.from('mova_artist_businesses').select('*').eq('id', actor.businessId).single();
    if (businessError || !business) return respond({ code: 'EXPORT_TENANT_NOT_FOUND' }, 404);
    output.mova_artist_businesses = [redactSecrets(business)];
    for (const table of tenantTables) {
      const relatedIds = table === 'mova_service_locations'
        ? ((output.mova_services ?? []) as Record<string, unknown>[]).map((row) => String(row.id))
        : table === 'mova_portfolio_service_links'
          ? ((output.mova_portfolio_items ?? []) as Record<string, unknown>[]).map((row) => String(row.id))
          : [];
      const rows = await fetchTenantRows(db, table, actor.businessId, relatedIds);
      if (table === 'mova_client_notes') {
        for (const note of rows) if (note.is_sensitive && typeof note.sensitive_ciphertext === 'string') note.body = await decryptNote(note.sensitive_ciphertext, `${actor.businessId}:${note.client_id}:${note.id}`);
      }
      if (table === 'mova_client_note_history') {
        for (const note of rows) if (note.is_sensitive && typeof note.sensitive_ciphertext === 'string') note.body = await decryptNote(note.sensitive_ciphertext, `${actor.businessId}:${note.client_id}:${note.note_id}`);
      }
      if (table === 'mova_location_policies') {
        for (const policy of rows) {
          if (typeof policy.door_code_encrypted === 'string') policy.door_code = await decryptDoorCode(policy.door_code_encrypted);
          delete policy.door_code_encrypted;
        }
      }
      if (table === 'mova_visit_note_media') {
        for (const media of rows) {
          const { data: signed, error: signError } = await db.storage.from('mova_visit_private').createSignedUrl(String(media.storage_path), 3600);
          if (signError) throw new Error('EXPORT_MEDIA_URL_FAILED');
          media.temporary_download_url = signed.signedUrl;
        }
      }
      output[table] = rows.map(redactSecrets);
    }
    const { error: auditError } = await db.from('mova_security_audit_events').insert({
      artist_business_id: actor.businessId,
      actor_user_id: actor.user.id,
      event_type: 'privacy.business_exported',
      object_type: 'business_export',
    });
    if (auditError) throw new Error('EXPORT_AUDIT_FAILED');
    return respond(payload);
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : 'EXPORT_FAILED';
    return respond({ code }, 500);
  }
}));
