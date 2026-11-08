// Task 5.1: five clients claim the same opened slot at once; exactly one wins.
// CI runs it against the Supabase container; locally set MOVA_RACE_PG="host=/tmp port=5433 dbname=..." to use psql.
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const local = process.env.MOVA_RACE_PG;
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const business = randomUUID();
const location = randomUUID();
const service = randomUUID();
const source = randomUUID();
const slot = randomUUID();
const clients = Array.from({ length: 5 }, () => randomUUID());

function psql(sql) {
  const [command, args] = local
    ? ['psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-At', '-d', local, '-c', sql]]
    : ['docker', ['exec', '-i', 'supabase_db_mova-app', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}
async function must(sql, what) { const result = await psql(sql); if (result.code !== 0) throw new Error(`${what} failed: ${result.stderr || result.stdout}`); return result.stdout; }
const token = (client) => `encode(sha256(convert_to('race-${suffix}-${client}','utf8')),'hex')`;

let failure;
try {
  await must(`
    insert into public.mova_artist_businesses(id,name,status) values('${business}','Slot race ${suffix}','active');
    insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone) values('${location}','${business}','Race studio','suite','instant','mova','artist','America/New_York');
    insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,base_price_minor,status) values('${service}','${business}','Silk press','Styling',90,15000,'active');
    insert into public.mova_clients(id,artist_business_id,display_name,phone,phone_normalized) select id,'${business}','Race client '||n,'+1202555'||lpad(n::text,4,'0'),'+1202555'||lpad(n::text,4,'0') from unnest(array['${clients.join("','")}']::uuid[]) with ordinality as c(id,n);
    insert into public.mova_appointments(id,artist_business_id,location_id,service_id,source,status,starts_at,ends_at,service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,client_name,client_locale,manage_token_hash,idempotency_key)
      values('${source}','${business}','${location}','${service}','artist','cancelled',now()+interval '3 days',now()+interval '3 days 90 minutes','Silk press',15000,0,15000,'Cancelled client','en-US',sha256(convert_to('${source}','utf8')),'race-source-${suffix}');
    insert into public.mova_slot_events(id,artist_business_id,location_id,starts_at,ends_at,origin,source_appointment_id,status,expires_at,dedupe_key,service_id,current_wave)
      values('${slot}','${business}','${location}',now()+interval '3 days',now()+interval '3 days 90 minutes','cancellation','${source}','live',now()+interval '2 days','race-${suffix}','${service}',1);
    insert into public.mova_slot_candidates(slot_event_id,artist_business_id,client_id,rank,wave,status,claim_token_hash)
      select '${slot}','${business}',id,n,1,'messaged',encode(sha256(convert_to('race-${suffix}-'||id::text,'utf8')),'hex') from unnest(array['${clients.join("','")}']::uuid[]) with ordinality as c(id,n);
  `, 'creating the race fixture');

  const results = await Promise.all(clients.map((client) => psql(`select pg_sleep(0.3); select public.mova_slot_claim(${token(client)})->>'status';`)));
  const statuses = results.map((result) => (result.code === 0 ? result.stdout.split('\n').pop() : `error: ${result.stderr}`));
  const claimed = statuses.filter((status) => status === 'claimed').length;
  const taken = statuses.filter((status) => status === 'taken').length;
  const bookings = Number(await must(`select count(*) from public.mova_appointments where artist_business_id='${business}' and source='seat_filler';`, 'counting bookings'));
  if (claimed !== 1 || taken !== 4 || bookings !== 1) throw new Error(`Expected 1 claimed, 4 taken, 1 booking; got ${JSON.stringify(statuses)} and ${bookings} bookings`);
  console.log('TC-D1-CLAIM-RACE-01 passed: 5 concurrent claims, 1 winner, 4 told the spot was taken, 1 booking');
} catch (error) {
  failure = error;
} finally {
  // The booking writes immutable ledger rows; remove this synthetic tenant with triggers off (superuser, test only).
  const cleanup = await psql(`set session_replication_role = replica; delete from public.mova_payment_ledger where artist_business_id='${business}'; delete from public.mova_artist_businesses where id='${business}';`);
  if (cleanup.code !== 0 && !failure) failure = new Error(`cleanup failed: ${cleanup.stderr}`);
}
if (failure) { console.error(failure.message); process.exit(1); }
