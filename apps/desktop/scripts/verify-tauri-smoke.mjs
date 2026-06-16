import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\');
const frontendDir = `${root}\\frontend`;
const tauriDir = `${root}`;

function runProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  return child;
}

async function waitForUrl(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function isUrlReady(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

let frontend;

let tauri;

try {
  const build = runProcess('cmd.exe', ['/c', 'npm', 'run', 'build'], {
    cwd: frontendDir,
  });
  const buildExitCode = await new Promise((resolve, reject) => {
    build.on('exit', (code) => resolve(code ?? 0));
    build.on('error', reject);
  });
  if (buildExitCode !== 0) {
    throw new Error(`Desktop frontend build exited with code ${buildExitCode}`);
  }

  if (await isUrlReady('http://127.0.0.1:3007')) {
    console.log('Reusing existing desktop frontend at http://127.0.0.1:3007');
  } else {
    frontend = runProcess('cmd.exe', ['/c', 'npm', 'run', 'dev', '--', '--host', '127.0.0.1'], {
      cwd: frontendDir,
    });
  }

  await waitForUrl('http://127.0.0.1:3007');

  tauri = runProcess('cargo', ['run', '--manifest-path', 'src-tauri/Cargo.toml'], {
    cwd: tauriDir,
    env: {
      ...process.env,
      STORYFORGE_DESKTOP_SKIP_SERVICES: '1',
      STORYFORGE_DESKTOP_SMOKE: '1',
    },
  });

  const exitCode = await new Promise((resolve, reject) => {
    tauri.on('exit', (code) => resolve(code ?? 0));
    tauri.on('error', reject);
  });

  if (exitCode !== 0) {
    throw new Error(`Tauri smoke exited with code ${exitCode}`);
  }

  console.log('Desktop Tauri smoke passed');
} finally {
  if (tauri && tauri.exitCode === null) {
    tauri.kill();
  }
  if (frontend && frontend.exitCode === null) {
    frontend.kill();
  }
}
