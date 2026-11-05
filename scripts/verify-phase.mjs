import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const problems = [];
const read = (path) => readFile(resolve(root, path), 'utf8');
function parseCsv(source) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted && char === '"' && source[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(value);
      value = '';
    } else if (!quoted && char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  const [header, ...data] = rows;
  return data.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}

const requiredFiles = [
  'AGENTS.md',
  'README.md',
  '.env.example',
  '.nvmrc',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '.github/workflows/ci.yml',
  'docs/product/ENGINEERING_SPEC.md',
  'docs/product/MASTER_BLUEPRINT.md',
  'docs/engineering/BASELINE_MANIFEST.md',
  'docs/engineering/PHASE_STATUS.md',
  'docs/engineering/REQUIREMENTS_MATRIX.csv',
  'docs/engineering/DECISION_LOG.md',
  'docs/engineering/CHANGE_REQUESTS.md',
  'docs/engineering/TEST_EVIDENCE.md',
  'docs/engineering/RELEASE_ACCEPTANCE.md',
  'docs/engineering/SALES_PROMISES_MATRIX.csv',
  'docs/engineering/SCREEN_INVENTORY.md',
  'docs/decisions/ADR-0001-stack-and-hosting.md',
  'docs/decisions/ADR-0002-i18n-runtime.md',
  'docs/decisions/ADR-0003-public-rendering.md',
];

for (const path of requiredFiles) {
  try {
    await read(path);
  } catch {
    problems.push(`Missing required P00 file: ${path}`);
  }
}

const [spec, baseline, status, decisions, matrix, inventory, evidence] = await Promise.all([
  read('docs/product/ENGINEERING_SPEC.md'),
  read('docs/engineering/BASELINE_MANIFEST.md'),
  read('docs/engineering/PHASE_STATUS.md'),
  read('docs/engineering/DECISION_LOG.md'),
  read('docs/engineering/REQUIREMENTS_MATRIX.csv'),
  read('docs/engineering/SCREEN_INVENTORY.md'),
  read('docs/engineering/TEST_EVIDENCE.md'),
]);
const matrixRows = parseCsv(matrix);
const qaRows = parseCsv(await read('docs/qa/TEST_CASES.csv'));
const qaCaseIds = new Set(qaRows.map((row) => row.case_id));

const expectedHash = baseline.match(/ENGINEERING_SPEC\.md[^\n]*?`([a-f0-9]{64})`/)?.[1];
const actualHash = createHash('sha256').update(spec).digest('hex');
if (!expectedHash || expectedHash !== actualHash) {
  problems.push(`Spec SHA-256 mismatch (manifest=${expectedHash ?? 'missing'}, actual=${actualHash})`);
}

for (let id = 1; id <= 26; id += 1) {
  const value = `D-${String(id).padStart(2, '0')}`;
  if (!decisions.includes(`| ${value} |`)) problems.push(`Decision log missing ${value}`);
  const line = decisions.split('\n').find((entry) => entry.startsWith(`| ${value} |`));
  if (line && line.split('|').map((cell) => cell.trim())[3] !== 'LOCKED') {
    problems.push(`${value} must remain LOCKED`);
  }
}
for (let id = 1; id <= 30; id += 1) {
  const value = `A-${String(id).padStart(2, '0')}`;
  if (!decisions.includes(`| ${value} |`)) problems.push(`Decision log missing ${value}`);
}

const requiredIds = new Set([
  ...Array.from(spec.matchAll(/F\d{2}-AC\d{2}/g), ([id]) => id),
  ...Array.from((await read('docs/qa/TEST_CASES.csv')).matchAll(/F\d{2}-V1-\d{2}/g), ([id]) => id),
  ...Array.from({ length: 26 }, (_, index) => `D-${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 30 }, (_, index) => `A-${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 60 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 20 }, (_, index) => `NFR-${String(index + 1).padStart(2, '0')}`),
]);
const matrixIds = new Set(Array.from(matrix.matchAll(/^((?:F\d{2}-AC\d{2}|F\d{2}-V1-\d{2}|D-\d{2}|A-\d{2}|T\d{2}|NFR-\d{2})),/gm), ([, id]) => id));
for (const id of requiredIds) {
  if (!matrixIds.has(id)) problems.push(`Requirements matrix missing ${id}`);
}
if (matrixRows.length !== requiredIds.size) {
  problems.push(`Requirements matrix has ${matrixRows.length} rows; expected ${requiredIds.size} unique requirement IDs`);
}
for (const row of matrixRows) {
  if (!row.test_files?.trim()) problems.push(`Requirements matrix row ${row.requirement_id} has no linked QA case ID`);
  for (const caseId of (row.test_files ?? '').split(';').map((value) => value.trim()).filter(Boolean)) {
    if (!qaCaseIds.has(caseId)) problems.push(`Requirements matrix row ${row.requirement_id} references missing QA case ${caseId}`);
  }
}

for (const line of decisions.split('\n')) {
  const match = line.match(/^\|\s*(A-\d{2})\s*\|/);
  if (!match) continue;
  const cells = line.split('|').map((cell) => cell.trim());
  const state = cells[5];
  const owner = cells[6];
  const decisionRecord = cells[7];
  if (!['OPEN', 'APPROVED', 'REJECTED', 'DEFERRED'].includes(state)) {
    problems.push(`${match[1]} has an invalid approval status: ${state}`);
  }
  if (state !== 'OPEN' && (!owner || !decisionRecord || decisionRecord === '—')) {
    problems.push(`${match[1]} is resolved without an owner, date, or rationale`);
  }
}

const packageJson = JSON.parse(await read('package.json'));
const nodePin = (await read('.nvmrc')).trim();
if (packageJson.engines?.node !== nodePin) problems.push('Node pin in package.json does not match .nvmrc');
if (!/^pnpm@\d+\.\d+\.\d+\+sha512\./.test(packageJson.packageManager ?? '')) {
  problems.push('package.json must pin pnpm with an exact version and integrity hash');
}
if (!/pnpm install --frozen-lockfile/.test(await read('.github/workflows/ci.yml'))) {
  problems.push('CI workflow must use a frozen lockfile install');
}

const screens = Array.from(inventory.matchAll(/^\|\s*(\d{2}[a-z]?)\s*\|/gim), ([, id]) => id.toLowerCase());
if (screens.length !== 51) problems.push(`Screen inventory has ${screens.length} artboards; expected 51`);
if (!/^\|\s*15\s*\|.*TABLED/im.test(inventory)) problems.push('Screen 15 must be marked TABLED');

const p00Done = /^\|\s*P00\s*\|\s*[^|]+\|\s*DONE(?:\s|$)/im.test(status);
if (p00Done) {
  const requiredEvidence = ['P00-AC01', 'P00-AC02', 'P00-AC03', 'P00-AC04'];
  for (const id of requiredEvidence) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^\\|\\s*${escaped}\\b[^|]*\\|\\s*PASS\\s*\\|`, 'm').test(evidence)) {
      problems.push(`P00 is marked DONE without PASS evidence for ${id}`);
    }
  }
}
if (process.argv.includes('--require-complete') && !p00Done) {
  problems.push('P00 is not marked DONE');
}

if (problems.length) {
  console.error(`P00 verification failed (${problems.length} issue${problems.length === 1 ? '' : 's'}):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`P00 structural verification passed: ${requiredIds.size} requirement IDs, ${screens.length} artboards, spec SHA-256 ${actualHash}`);
}
