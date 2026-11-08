import { execFileSync } from 'node:child_process';

const base = process.env.MIGRATION_DIFF_BASE;
if (!base) {
  console.error('TC-REL-MIGR-01 requires MIGRATION_DIFF_BASE (the previous main SHA or pull request base SHA).');
  process.exit(2);
}

const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`, '--', 'supabase/migrations'], { encoding: 'utf8' })
  .split('\n').filter((path) => path.endsWith('.sql'));
const violations = [];
for (const path of changed) {
  try {
    execFileSync('git', ['cat-file', '-e', `${base}:${path}`], { stdio: 'ignore' });
    violations.push(path);
  } catch {
    // A migration absent from the base is an allowed addition.
  }
}

if (violations.length) {
  console.error(`TC-REL-MIGR-01 failed: existing migration files changed: ${violations.join(', ')}`);
  process.exit(1);
}
console.log(`TC-REL-MIGR-01 passed: ${changed.length} migration paths changed and all are additions`);
