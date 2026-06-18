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

  child.output = '';
  child.stdout.on('data', (chunk) => {
    child.output += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    child.output += chunk.toString();
    process.stderr.write(chunk);
  });

  return child;
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
}

async function waitForExit(child, label, timeoutMs) {
  let timeout;
  const exit = new Promise((resolve, reject) => {
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', reject);
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      if (child.exitCode === null) {
        killProcessTree(child);
      }
      const tail = child.output?.slice(-4000) ?? '';
      reject(new Error(`${label} timed out after ${timeoutMs}ms\n--- output tail ---\n${tail}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([exit, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
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
  const buildExitCode = await waitForExit(build, 'Desktop frontend build', 120000);
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

  tauri = runProcess(
    'cargo',
    ['run', '--manifest-path', 'src-tauri/Cargo.toml', '--target-dir', '.tauri-target-smoke'],
    {
      cwd: tauriDir,
      env: {
        ...process.env,
        STORYFORGE_DESKTOP_SKIP_SERVICES: '1',
        STORYFORGE_DESKTOP_SMOKE: '1',
      },
    },
  );

  const exitCode = await waitForExit(tauri, 'Desktop Tauri smoke', 300000);

  if (exitCode !== 0) {
    throw new Error(`Tauri smoke exited with code ${exitCode}`);
  }

  console.log('Desktop Tauri smoke passed');
} finally {
  killProcessTree(tauri);
  killProcessTree(frontend);
}
