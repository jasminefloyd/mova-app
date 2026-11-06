import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const resourceDirectory = resolve(scriptDirectory, '../apps/web/src/i18n/resources');

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
  return problems;
}

async function checkLocaleFiles() {
  const [enText, esText, criticalText] = await Promise.all([
    readFile(resolve(resourceDirectory, 'en-US/common.json'), 'utf8'),
    readFile(resolve(resourceDirectory, 'es-US/common.json'), 'utf8'),
    readFile(resolve(scriptDirectory, '../apps/web/src/i18n/critical-keys.json'), 'utf8'),
  ]);
  const problems = validateLocaleCatalogs({ 'en-US': JSON.parse(enText), 'es-US': JSON.parse(esText) }, JSON.parse(criticalText));
  if (problems.length) {
    console.error(`Locale validation failed (${problems.length} issue${problems.length === 1 ? '' : 's'}):`);
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Locale validation passed: en-US and es-US have matching keys and ${JSON.parse(criticalText).length} critical strings.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkLocaleFiles();
