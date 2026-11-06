import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const required = [
  'packages/design-tokens/package.json',
  'packages/design-tokens/src/tokens.css',
  'apps/web/src/components/index.tsx',
  'apps/web/src/components/components.css',
  'apps/web/src/app/ArtistShell.tsx',
  'apps/web/src/app/ArtistPages.tsx',
  'tests/unit/design-system.test.tsx',
  'tests/e2e/navigation.spec.ts',
  'tests/visual/design-system.spec.ts',
];
const issues = [];
for (const path of required) {
  try { await read(path); } catch { issues.push(`Missing P02 file: ${path}`); }
}

const tokens = JSON.parse(await read('docs/design/tokens/tokens.json'));
const css = await read('packages/design-tokens/src/tokens.css');
for (const color of ['#18392F', '#264E3E', '#8BA990', '#C9E6D4', '#E7C3AA', '#F7F5EF', '#3F4D46', '#4F5F57', '#DCE1D9']) {
  if (!css.toLowerCase().includes(color.toLowerCase())) issues.push(`Token CSS is missing source value ${color}`);
}
const components = await read('apps/web/src/components/index.tsx');
for (const name of ['Button', 'StatusChip', 'Toggle', 'OptionGroup', 'Sheet', 'MiniBarChart', 'EmptyState', 'ErrorState', 'PermissionDeniedState', 'OfflineBanner', 'TabBar', 'ComponentGallery']) {
  if (!components.includes(`function ${name}`)) issues.push(`Missing design component ${name}`);
}
const en = JSON.parse(await read('apps/web/src/i18n/resources/en-US/common.json'));
const es = JSON.parse(await read('apps/web/src/i18n/resources/es-US/common.json'));
if (en.navigation?.growth !== 'AI Revenue' || typeof es.navigation?.growth !== 'string') issues.push('AI Revenue navigation label must use the shared translated navigation.growth key');
if (en.navigation?.growthTitle !== 'AI Revenue Center' || typeof es.navigation?.growthTitle !== 'string') issues.push('AI Revenue Center title must be translated separately from its tab label');
const appSource = await read('apps/web/src/app/ArtistPages.tsx');
if (!appSource.includes("t(`navigation.${section}`)")) issues.push('Tab page title must reuse the translated navigation key');
if (tokens?.color?.brand?.forest?.$value !== '#18392F') issues.push('Design token JSON source changed unexpectedly');

const routes = await read('apps/web/src/router.tsx');
if (!routes.includes("path: 'components'") || !routes.includes('import.meta.env.DEV')) issues.push('Component gallery must be development-only');
if (routes.toLowerCase().includes('outreach')) issues.push('Tabled screen 15 must not be routed');

if (issues.length) {
  console.error(`P02 verification failed (${issues.length} issue${issues.length === 1 ? '' : 's'}):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log('P02 structural verification passed: tokens, components, navigation, translations, and dev-only gallery are present.');
}
