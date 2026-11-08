import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { findDirectReadViolations } from './check-direct-reads.mjs';

test('TC-STATIC-GRANTS-01 rejects the former Home quote and slot direct reads', async () => {
  const fixture = await makeFixture({
    source: "client.from('mova_quote_requests').select('*'); client.from('mova_slot_events').select('*');",
    migration: 'grant select on public.mova_appointments to authenticated;',
  });
  try {
    const { violations } = await findDirectReadViolations(fixture.source, fixture.migrations, fixture.root);
    assert.equal(violations.length, 2);
    assert.match(violations.join('\n'), /mova_quote_requests/);
    assert.match(violations.join('\n'), /mova_slot_events/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('TC-STATIC-GRANTS-01 accepts authenticated table grants and excludes Storage buckets', async () => {
  const fixture = await makeFixture({
    source: "client.from('mova_appointments').select('*'); client.storage.from('mova_profile_photos').createSignedUrl(path, 300);",
    migration: 'grant select, update on public.mova_appointments to authenticated;',
  });
  try {
    const { violations } = await findDirectReadViolations(fixture.source, fixture.migrations, fixture.root);
    assert.deepEqual(violations, []);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('TC-STATIC-GRANTS-01 respects later authenticated SELECT revokes', async () => {
  const fixture = await makeFixture({
    source: "client.from('mova_appointments').select('*');",
    migration: 'grant select on public.mova_appointments to authenticated; revoke select on public.mova_appointments from authenticated;',
  });
  try {
    const { violations } = await findDirectReadViolations(fixture.source, fixture.migrations, fixture.root);
    assert.equal(violations.length, 1);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

async function makeFixture({ source, migration }) {
  const root = await mkdtemp(resolve(tmpdir(), 'mova-direct-reads-'));
  const sourceRoot = resolve(root, 'apps/web/src');
  const migrations = resolve(root, 'supabase/migrations');
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(migrations, { recursive: true });
  await writeFile(resolve(sourceRoot, 'fixture.ts'), source);
  await writeFile(resolve(migrations, '0001_fixture.sql'), migration);
  return { root, source: sourceRoot, migrations };
}
