import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';

export async function findDirectReadViolations(sourceRoot, migrationRoot, relativeRoot = root) {
  const files = await listFiles(sourceRoot, (path) => /\.(?:ts|tsx|js|jsx)$/.test(path));
  const migrations = (await listFiles(migrationRoot, (path) => path.endsWith('.sql'))).sort();
  const grants = new Set();
  const violations = [];

  for (const path of migrations) {
    const sql = await readFile(path, 'utf8');
    for (const statement of sql.matchAll(/\b(grant|revoke)\s+([^;]+?)\s+on\s+(?:table\s+)?([^;]+?)\s+(?:to|from)\s+([^;]+);/gis)) {
      const [, action, privileges, tableList, roleList] = statement;
      if (!roleList.split(',').some((role) => role.trim().replaceAll('"', '').toLowerCase() === 'authenticated')) continue;
      if (!/(?:all|select)/i.test(privileges)) continue;
      for (const table of tableList.split(',')) {
        const name = table.trim().replace(/^public\./i, '').replaceAll('"', '');
        if (/^mova_[a-z0-9_]+$/i.test(name)) {
          if (action.toLowerCase() === 'grant') grants.add(name);
          else grants.delete(name);
        }
      }
    }
  }

  for (const path of files) {
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(/\.from\(\s*(['"`])(mova_[a-z0-9_]+)\1\s*\)/gi)) {
      const prefix = source.slice(Math.max(0, match.index - 24), match.index);
      if (/\.storage$/.test(prefix.trimEnd())) continue;
      const table = match[2].toLowerCase();
      if (!grants.has(table)) violations.push(`${path.slice(relativeRoot.length + 1)}: ${table} has no authenticated SELECT grant in migrations`);
    }
  }
  return { files: files.length, violations };
}

if (invokedPath === import.meta.url) {
  const result = await findDirectReadViolations(resolve(root, 'apps/web/src'), resolve(root, 'supabase/migrations'));
  if (result.violations.length) {
    console.error(`TC-STATIC-GRANTS-01 failed: ${result.violations.length} direct reads lack an authenticated SELECT grant`);
    for (const violation of result.violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(`TC-STATIC-GRANTS-01 passed: checked browser table reads in ${result.files} files against migration grants`);
  }
}

async function listFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listFiles(path, predicate);
    return predicate(path) ? [path] : [];
  }));
  return nested.flat();
}
