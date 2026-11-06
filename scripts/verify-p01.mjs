import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];
const required = [
  'apps/web/index.html',
  'apps/web/src/app/ArtistShell.tsx',
  'apps/web/src/app/PublicShell.tsx',
  'apps/web/src/app/ClientShell.tsx',
  'apps/web/src/app/OnboardingShell.tsx',
  'apps/web/src/pwa/cache-policy.ts',
  'apps/web/src/i18n/resources/en-US/common.json',
  'apps/web/src/i18n/resources/es-US/common.json',
  'packages/contracts/src/api.ts',
  'packages/contracts/src/errors.ts',
  'packages/contracts/src/enums.ts',
  'packages/contracts/src/locale.ts',
  'supabase/config.toml',
  'vercel.json',
  'docs/operations/environments.md',
  'docs/operations/secrets.md',
];

for (const path of required) {
  try { await readFile(resolve(root, path)); }
  catch { failures.push(`Missing P01 file: ${path}`); }
}

const policy = await readFile(resolve(root, 'apps/web/src/pwa/cache-policy.ts'), 'utf8');
if (/runtimeCaching\s*:/.test(policy)) failures.push('PWA cache policy must not define runtime API caching');
for (const endpoint of ['functions', 'rest', 'auth', 'storage', 'graphql']) {
  if (!policy.includes(`\\/${endpoint}\\/v1`)) failures.push(`PWA navigation denylist is missing /${endpoint}/v1/`);
}

const phaseStatus = await readFile(resolve(root, 'docs/engineering/PHASE_STATUS.md'), 'utf8');
if (!/^\| P01 \|[^\n]*\| IN PROGRESS \|/m.test(phaseStatus)) failures.push('P01 must be recorded IN PROGRESS until its acceptance evidence and external setup are complete');

if (failures.length) {
  console.error(`P01 structural verification failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('P01 structural verification passed: shell, contract, locale, Supabase config, and asset-only PWA files are present.');
}
