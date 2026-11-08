import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'local-test-placeholder',
  VITE_WAITLIST_ENABLED: 'false',
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
