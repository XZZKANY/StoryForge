import { spawn } from 'node:child_process';

const frontendUrl = process.env.STORYFORGE_DESKTOP_FRONTEND_URL ?? 'http://127.0.0.1:3007';

async function isFrontendReady() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(frontendUrl, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

if (await isFrontendReady()) {
  console.log(`[desktop-frontend] Reusing existing Vite dev server at ${frontendUrl}`);
  process.exit(0);
}

console.log(`[desktop-frontend] Starting Vite dev server at ${frontendUrl}`);

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1'], {
  stdio: 'inherit',
  env: process.env,
});

function stopChild() {
  if (!child.killed) {
    child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGINT');
  }
}

process.on('SIGINT', () => {
  stopChild();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopChild();
  process.exit(0);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(0);
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(`[desktop-frontend] Failed to start Vite dev server: ${error.message}`);
  process.exit(1);
});
