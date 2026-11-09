import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { accessTokenFor, googleProvider, CONNECTION_COLUMNS, type GoogleConnectionRow } from '../_shared/google-connection.ts';
import { GOOGLE_CALENDAR_SCOPE } from '../_shared/providers/google/index.ts';

// One-way sync (P6): Mova appointments -> the stylist's chosen Google calendar. Runs from the cron route with
// CRON_SECRET. Reads the single connection row; writes go through the Google provider adapter.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = Deno.env.get('CRON_SECRET'); if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) return respond({ code: 'UNAUTHORIZED' }, 401);
  const provider = googleProvider();
  if (!provider) return respond({ code: 'GOOGLE_NOT_CONFIGURED', synced: 0, failed: 0 }, 503);
  const db = serviceClient();
  const { data: connections, error } = await db.from('mova_google_connections').select(CONNECTION_COLUMNS).eq('status', 'active').eq('calendar_enabled', true).limit(100);
  if (error) return respond({ code: 'CALENDAR_CONNECTIONS_FAILED' }, 500);
  let synced = 0; let failed = 0;
  for (const connection of (connections ?? []) as GoogleConnectionRow[]) {
    if (!connection.granted_scopes.includes(GOOGLE_CALENDAR_SCOPE)) { failed++; continue; }
    try {
      const accessToken = await accessTokenFor(provider, connection).catch(async (cause) => {
        if (cause instanceof Error && cause.message === 'GOOGLE_REFRESH_FAILED') await db.from('mova_google_connections').update({ status: 'error' }).eq('artist_business_id', connection.artist_business_id);
        throw new Error('GOOGLE_REFRESH_FAILED');
      });
      const { data: settings } = await db.from('mova_calendar_sync_settings').select('location_ids').eq('artist_business_id', connection.artist_business_id).maybeSingle();
      let query = db.from('mova_appointments').select('id,service_name_snapshot,starts_at,ends_at,status,location_id,updated_at').eq('artist_business_id', connection.artist_business_id).in('status', ['pending_artist', 'confirmed', 'completed', 'cancelled']).gt('ends_at', new Date(Date.now() - 45 * 86400000).toISOString()).limit(500);
      if (settings?.location_ids?.length) query = query.in('location_id', settings.location_ids);
      const { data: appointments, error: appointmentError } = await query; if (appointmentError) throw new Error('APPOINTMENT_READ_FAILED');
      const { data: mappings } = await db.from('mova_external_calendar_events').select('appointment_id,provider_event_id,event_sequence').eq('artist_business_id', connection.artist_business_id);
      const mapped = new Map((mappings ?? []).map((row: { appointment_id: string; provider_event_id: string; event_sequence: number }) => [row.appointment_id, row]));
      for (const appointment of appointments ?? []) {
        const old = mapped.get(appointment.id); const cancelled = appointment.status === 'cancelled';
        if (cancelled && !old) continue;
        const eventId = old?.provider_event_id ?? `mova${appointment.id.replaceAll('-', '')}`;
        const sequence = Math.max(old?.event_sequence ?? 0, Math.floor(new Date(appointment.updated_at).getTime() / 1000));
        await provider.saveCalendarEvent(accessToken, connection.calendar_id, { eventId, summary: appointment.service_name_snapshot || 'Appointment', startsAt: appointment.starts_at, endsAt: appointment.ends_at, cancelled, sequence, exists: Boolean(old) });
        const { error: saveError } = await db.from('mova_external_calendar_events').upsert({ artist_business_id: connection.artist_business_id, appointment_id: appointment.id, provider_event_id: eventId, provider_calendar_id: connection.calendar_id, event_sequence: sequence, last_synced_at: new Date().toISOString() }, { onConflict: 'appointment_id' });
        if (saveError) throw new Error('EVENT_MAPPING_SAVE_FAILED');
        synced++;
      }
    } catch { failed++; }
  }
  return respond({ synced, failed });
});
