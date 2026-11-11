import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const resourceDirectory = resolve(scriptDirectory, '../apps/web/src/i18n/resources');
const sourceDirectory = resolve(scriptDirectory, '../apps/web/src');

function leafMap(value, prefix = '', result = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) leafMap(child, path, result);
    else if (typeof child === 'string') result.set(path, child);
    else throw new TypeError(`Locale value must be a string or object at ${path}`);
  }
  return result;
}

export function validateLocaleCatalogs(catalogs, criticalKeys) {
  const problems = [];
  const en = leafMap(catalogs['en-US']);
  const es = leafMap(catalogs['es-US']);
  const allKeys = new Set([...en.keys(), ...es.keys()]);

  for (const key of allKeys) {
    if (!en.has(key)) problems.push(`en-US is missing ${key}`);
    if (!es.has(key)) problems.push(`es-US is missing ${key}`);
  }
  for (const key of criticalKeys) {
    for (const [locale, catalog] of [['en-US', en], ['es-US', es]]) {
      if (!catalog.has(key) || !catalog.get(key)?.trim()) problems.push(`${locale} is missing critical string ${key}`);
    }
  }
  for (const [locale, catalog] of [['en-US', en], ['es-US', es]]) {
    for (const [key, value] of catalog) {
      // The public profile reference explicitly labels its customer-facing work gallery "Portfolio photo".
      if (key !== 'showcase.portfolioPhoto' && /portfolio|portafolio/i.test(value)) problems.push(`${locale} still exposes the retired stylist-facing term at ${key}`);
    }
  }
  return problems;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

async function validateLiteralTranslationCalls(catalogs) {
  const knownKeys = leafMap(catalogs['en-US']);
  const files = await sourceFiles(sourceDirectory);
  const problems = [];
  const callPattern = /\b(?:t|i18n\.t)\(\s*(['"`])([^'"`]+)\1/g;
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(callPattern)) {
      const key = match[2];
      if (key && !key.includes('${') && !knownKeys.has(key) && !knownKeys.has(`${key}_other`)) problems.push(`${path.replace(`${sourceDirectory}/`, '')} references missing translation ${key}`);
    }
  }
  return problems;
}

async function checkLocaleFiles() {
  const [enText, esText, criticalText] = await Promise.all([
    readFile(resolve(resourceDirectory, 'en-US/common.json'), 'utf8'),
    readFile(resolve(resourceDirectory, 'es-US/common.json'), 'utf8'),
    readFile(resolve(scriptDirectory, '../apps/web/src/i18n/critical-keys.json'), 'utf8'),
  ]);
  const catalogs = { 'en-US': JSON.parse(enText), 'es-US': JSON.parse(esText) };
  const problems = [...validateLocaleCatalogs(catalogs, JSON.parse(criticalText)), ...await validateLiteralTranslationCalls(catalogs)];
  if (problems.length) {
    console.error(`Locale validation failed (${problems.length} issue${problems.length === 1 ? '' : 's'}):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Locale validation passed: en-US and es-US have matching keys, all literal translation calls resolve, and ${JSON.parse(criticalText).length} critical strings exist.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkLocaleFiles();
