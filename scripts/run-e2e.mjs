import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  // Keep all server-side SSR calls on the local stand-in even when the developer env has production keys.
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-placeholder',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'local-test-placeholder',
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'local-test-placeholder',
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 1));
  });
}

const buildCode = await run('corepack', ['pnpm', 'build']);
if (buildCode !== 0) process.exit(buildCode);

const testArgs = process.argv.slice(2);
if (testArgs[0] === '--') testArgs.shift();
const testCode = await run('corepack', ['pnpm', 'exec', 'playwright', 'test', ...testArgs]);
process.exit(testCode);
