#!/usr/bin/env node
// Run every pgTAP file in supabase/tests against a fresh local database, one database per file.
// Needs a reachable PostgreSQL 16+ with the pgTAP extension installed (see docs/operations/environments.md).
// Connection comes from the standard PG* variables (PGHOST, PGPORT, PGUSER). Refuses anything that is not local.
// Usage: node scripts/db-test.mjs [--with-seed] [--keep] [pattern]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const withSeed = args.includes('--with-seed');
const keep = args.includes('--keep');
const pattern = args.find((arg) => !arg.startsWith('--'));
const host = process.env.PGHOST || '/tmp';
if (!(host.startsWith('/') || ['localhost', '127.0.0.1', '::1'].includes(host))) {
  console.error(`db-test refuses non-local PGHOST "${host}". Tests never run against hosted databases.`);
  process.exit(2);
}
const env = { ...process.env, PGHOST: host, PGUSER: process.env.PGUSER || 'postgres', PGPORT: process.env.PGPORT || '5432' };
const psql = (db, extra, opts = {}) => spawnSync('psql', ['-X', '-q', '-d', db, ...extra], { env, encoding: 'utf8', ...opts });
const must = (db, extra) => { const r = psql(db, ['-v', 'ON_ERROR_STOP=1', ...extra]); if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); } };

const template = withSeed ? 'mova_test_template_seed' : 'mova_test_template';
must('postgres', ['-c', `drop database if exists ${template}`, '-c', `create database ${template}`]);
must(template, ['-f', 'scripts/local-db/bootstrap.sql']);
const migrations = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
for (const file of migrations) must(template, ['-f', join('supabase/migrations', file)]);
if (withSeed) must(template, ['-f', 'supabase/seed.sql']);
must(template, ['-c', 'create extension if not exists pgtap']);
console.log(`Template ready: ${migrations.length} migrations${withSeed ? ' + seed' : ''}.`);

const files = readdirSync('supabase/tests').filter((f) => f.endsWith('.sql') && (!pattern || f.includes(pattern))).sort();
let failedFiles = 0; let passed = 0; let planned = 0;
for (const file of files) {
  const db = 'mova_test_run';
  must('postgres', ['-c', `drop database if exists ${db}`, '-c', `create database ${db} template ${template}`]);
  const r = psql(db, ['-f', join('supabase/tests', file)]);
  const out = `${r.stdout}\n${r.stderr}`;
  const ok = (out.match(/^\s*ok \d+/gm) || []).length;
  const notOk = (out.match(/^\s*not ok \d+/gm) || []).length;
  const plan = Number((out.match(/^\s*1\.\.(\d+)/m) || [])[1] || 0);
  const error = (out.match(/ERROR:.*$/m) || [''])[0];
  const good = notOk === 0 && plan > 0 && ok === plan && !error;
  passed += ok; planned += plan; if (!good) failedFiles++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${file.padEnd(48)} ${ok}/${plan}${error ? `  ${error.slice(0, 140)}` : ''}`);
  if (!good && process.env.DB_TEST_VERBOSE) console.log(out.split('\n').filter((l) => /not ok|#|ERROR/.test(l)).slice(0, 30).join('\n'));
}
if (!keep) psql('postgres', ['-c', 'drop database if exists mova_test_run']);
console.log(`\n${files.length - failedFiles}/${files.length} files pass, ${passed}/${planned} assertions.`);
process.exit(failedFiles ? 1 : 0);
