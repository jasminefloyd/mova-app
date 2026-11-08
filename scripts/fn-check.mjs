#!/usr/bin/env node
// Type-check every Edge Function entry point and run the shared Deno tests.
// Usage: node scripts/fn-check.mjs   (env: DENO=path to deno, MOVA_DENO_IMPORT_MAP=optional offline import map)
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const deno = process.env.DENO || 'deno';
const root = 'supabase/functions';
const entries = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(`${root}/${d.name}/index.ts`))
  .map((d) => `${root}/${d.name}/index.ts`);
const empty = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !existsSync(`${root}/${d.name}/index.ts`)).map((d) => d.name);
const map = process.env.MOVA_DENO_IMPORT_MAP ? [`--import-map=${process.env.MOVA_DENO_IMPORT_MAP}`] : [];
const flags = ['--no-config', '--node-modules-dir=none', ...map];
const run = (args) => spawnSync(deno, args, { stdio: 'inherit' }).status;
console.log(`deno check: ${entries.length} functions (${empty.length} folders without index.ts)`);
const check = run(['check', ...flags, ...entries]);
// Deno tests: every *.test.ts under supabase/functions that is not a Vitest file (Vitest ones run in `pnpm test`).
const testFiles = [];
for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const f of readdirSync(`${root}/${dir.name}`)) {
    const path = `${root}/${dir.name}/${f}`;
    if (f.endsWith('.test.ts') && !/from ['"]vitest['"]/.test(readFileSync(path, 'utf8'))) testFiles.push(path);
  }
}
console.log(`deno test: ${testFiles.length} files`);
const test = testFiles.length ? run(['test', '--allow-env', ...flags, ...testFiles]) : 0;
process.exit(check || test ? 1 : 0);
