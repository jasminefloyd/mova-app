import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const container = 'supabase_db_mova-app';
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const handle = `claim-${suffix}`;
const users = [randomUUID(), randomUUID()];

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function requireSuccess(sql, description) {
  const result = await psql(sql);
  if (result.code !== 0) throw new Error(`${description} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

const escapedHandle = handle.replaceAll("'", "''");
const cleanup = `
  delete from public.mova_artist_businesses business
  using public.mova_artist_profiles profile
  where profile.artist_business_id=business.id and profile.handle='${escapedHandle}';
  delete from auth.users where id in ('${users[0]}','${users[1]}');
`;

let failure;
try {
  await requireSuccess(`
    insert into auth.users (id,aud,role,email,email_confirmed_at) values
      ('${users[0]}','authenticated','authenticated','claim-race-a-${suffix}@example.invalid',now()),
      ('${users[1]}','authenticated','authenticated','claim-race-b-${suffix}@example.invalid',now());
  `, 'creating synthetic verified users');

  const attempts = users.map((userId, index) => psql(`
    begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${userId}',true);
    select pg_sleep(0.4);
    select * from public.mova_claim_artist_profile(
      'Race Artist ${index + 1}', '${escapedHandle}', array['Stylist'], '', 'en-US'
    );
    commit;
  `));
  const results = await Promise.all(attempts);
  const successes = results.filter((result) => result.code === 0);
  const expectedConflicts = results.filter((result) => result.code !== 0 && result.stderr.includes('HANDLE_TAKEN'));
  if (successes.length !== 1 || expectedConflicts.length !== 1) {
    throw new Error(`Expected one successful claim and one HANDLE_TAKEN conflict; outcomes: ${results.map((result) => `${result.code}: ${result.stderr || result.stdout}`).join(' | ')}`);
  }

  const counts = await requireSuccess(`
    select
      (select count(*) from public.mova_artist_profiles where lower(handle)='${escapedHandle}') || '|' ||
      (select count(*) from public.mova_artist_memberships m join public.mova_artist_profiles p using (artist_business_id) where lower(p.handle)='${escapedHandle}' and m.status='active' and m.role='owner') || '|' ||
      (select count(*) from public.mova_onboarding_progress op join public.mova_artist_profiles p using (artist_business_id) where lower(p.handle)='${escapedHandle}');
  `, 'checking claim transaction results');
  if (counts !== '1|1|1') throw new Error(`Concurrent claim left inconsistent rows (${counts}); expected 1 profile, 1 owner membership, 1 onboarding row.`);
  console.log('Handle claim concurrency check passed: one profile committed, the competing claim returned HANDLE_TAKEN, and no partial rows remained.');
} catch (error) {
  failure = error;
}

const cleanupResult = await psql(cleanup);
if (cleanupResult.code !== 0 && !failure) {
  failure = new Error(`Cleaning synthetic claim-race rows failed: ${cleanupResult.stderr || cleanupResult.stdout}`);
}
if (failure) throw failure;
