import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\');
const frontendDir = `${root}\\frontend`;
const tauriDir = `${root}`;
const releaseExecutable = `${root}\\src-tauri\\target\\release\\storyforge-desktop.exe`;
export const SMOKE_ISOLATION_PROTOCOL = 'storyforge-smoke-isolation-v1';

function argumentValue(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1] ?? '';
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? '';
}

const executableArgument = argumentValue('--executable');
const explicitExecutable = executableArgument
  ? isAbsolute(executableArgument)
    ? executableArgument
    : resolve(process.cwd(), executableArgument)
  : '';
const releaseMode = process.argv.includes('--release') || !!explicitExecutable;
const smokeLabel = explicitExecutable ? 'installed' : releaseMode ? 'release' : 'development';

function directoryArgument(name) {
  const value = argumentValue(name);
  if (!value) return '';
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

const explicitSmokeDirectories = {
  localDataDir: directoryArgument('--local-data-dir'),
  configDir: directoryArgument('--config-dir'),
  webviewDataDir: directoryArgument('--webview-data-dir'),
};
const explicitDirectoryCount = Object.values(explicitSmokeDirectories).filter(Boolean).length;
if (explicitDirectoryCount !== 0 && explicitDirectoryCount !== 3) {
  throw new Error(
    'Tauri smoke requires --local-data-dir, --config-dir, and --webview-data-dir together',
  );
}

export async function findFreeLoopbackApiBaseUrl() {
  const port = await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a loopback API port for Tauri smoke'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
  return `http://127.0.0.1:${port}`;
}

export function createSmokeEnvironment(environment, apiBaseUrl, directories) {
  for (const [name, path] of Object.entries(directories)) {
    if (!isAbsolute(path)) throw new Error(`Tauri smoke ${name} must be absolute: ${path}`);
  }
  return {
    ...environment,
    STORYFORGE_API_BASE_URL: apiBaseUrl,
    STORYFORGE_DESKTOP_SMOKE_LOCAL_DATA_DIR: directories.localDataDir,
    STORYFORGE_DESKTOP_SMOKE_CONFIG_DIR: directories.configDir,
    STORYFORGE_DESKTOP_REUSE_API: '0',
    STORYFORGE_DESKTOP_SKIP_SERVICES: '1',
    STORYFORGE_DESKTOP_SMOKE: '1',
    STORYFORGE_SHADOW_GIT_SMOKE_CLEAR_PATH: '1',
    WEBVIEW2_USER_DATA_FOLDER: directories.webviewDataDir,
  };
}

export function assertSmokeBinaryCapability(binary) {
  const payload = Buffer.isBuffer(binary) ? binary : Buffer.from(binary);
  if (!payload.includes(Buffer.from(SMOKE_ISOLATION_PROTOCOL))) {
    throw new Error(
      `Release executable does not support isolated Tauri smoke (${SMOKE_ISOLATION_PROTOCOL})`,
    );
  }
}

export function verifiedSmokeExecutable(
  explicitPath,
  fallbackPath,
  pathExists = existsSync,
  readBinary = readFileSync,
) {
  const executable = explicitPath || fallbackPath;
  if (!pathExists(executable)) {
    throw new Error(`Tauri smoke executable is missing: ${executable}`);
  }
  assertSmokeBinaryCapability(readBinary(executable));
  return executable;
}

function normalizeEvidencePath(path) {
  return path
    .trim()
    .replace(/^\\\\\?\\/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function assertSmokeEvidence(output, expectedLocalDataDir) {
  if (!output.includes(`Desktop Tauri smoke isolation: ${SMOKE_ISOLATION_PROTOCOL}`)) {
    throw new Error('Tauri process exited without the smoke isolation marker');
  }
  const markerIndex = output.lastIndexOf('Desktop Tauri smoke result:');
  if (markerIndex < 0) throw new Error('Tauri process exited without the smoke result marker');
  const marker = output.slice(markerIndex);
  const repository = marker.match(/shadowRepositoryPath=([^\r\n]+)/)?.[1];
  if (!repository) throw new Error('Tauri smoke result is missing shadowRepositoryPath');
  const expected = normalizeEvidencePath(expectedLocalDataDir);
  const actual = normalizeEvidencePath(repository);
  if (actual !== expected && !actual.startsWith(`${expected}/`)) {
    throw new Error(`Tauri smoke shadow repository escaped its isolated data root: ${repository}`);
  }
}

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

export function killProcessTree(
  child,
  platform = process.platform,
  runSynchronous = spawnSync,
) {
  if (
    !child ||
    child.exitCode !== null ||
    (child.signalCode ?? null) !== null ||
    !Number.isInteger(child.pid)
  ) {
    return;
  }
  if (platform === 'win32') {
    runSynchronous('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 15000,
      windowsHide: true,
    });
    return;
  }
  if (child.exitCode === null) child.kill('SIGTERM');
}

export async function waitForExit(child, label, timeoutMs) {
  let timeout;
  const exit = new Promise((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${label} terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
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

export async function isUrlReachable(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { signal: globalThis.AbortSignal.timeout(2000) });
    try {
      await response.body?.cancel?.();
    } catch {
      // Receiving the response already proves reachability; body cleanup is best-effort.
    }
    return true;
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return true;
    return false;
  }
}

async function waitForUrlToStop(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await isUrlReachable(url))) return;
    await delay(250);
  }
  throw new Error(`Tauri smoke API remained reachable after process cleanup: ${url}`);
}

export async function removeTemporaryDataRootIfApiStopped(
  temporaryDataRoot,
  apiStopped,
  remover = rm,
) {
  if (!temporaryDataRoot || !apiStopped) return false;
  await remover(temporaryDataRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
  return true;
}

export async function settleSmokeCleanup(
  failure,
  smokeApiReadyUrl,
  temporaryDataRoot,
  waitForStop = waitForUrlToStop,
  removeDataRoot = removeTemporaryDataRootIfApiStopped,
) {
  let cleanupFailure = failure;
  let apiStopped = !smokeApiReadyUrl;
  if (smokeApiReadyUrl) {
    try {
      await waitForStop(smokeApiReadyUrl);
      apiStopped = true;
    } catch (error) {
      cleanupFailure = cleanupFailure
        ? new AggregateError([cleanupFailure, error], 'Tauri smoke or API cleanup failed')
        : error;
    }
  }
  if (temporaryDataRoot) {
    try {
      await removeDataRoot(temporaryDataRoot, apiStopped);
    } catch (error) {
      cleanupFailure = cleanupFailure
        ? new AggregateError([cleanupFailure, error], 'Tauri smoke or data cleanup failed')
        : error;
    }
  }
  return cleanupFailure;
}

export async function verifyTauriSmoke() {
  let frontend;
  let tauri;
  let temporaryDataRoot;
  let smokeApiReadyUrl;
  let failure;

  try {
    const smokeExecutable = releaseMode
      ? verifiedSmokeExecutable(explicitExecutable, releaseExecutable)
      : '';

    if (!explicitExecutable) {
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
    }

    let smokeDirectories = explicitSmokeDirectories;
    if (!explicitDirectoryCount) {
      temporaryDataRoot = await mkdtemp(join(tmpdir(), 'storyforge-tauri-smoke-'));
      smokeDirectories = {
        localDataDir: join(temporaryDataRoot, 'local-data'),
        configDir: join(temporaryDataRoot, 'config'),
        webviewDataDir: join(temporaryDataRoot, 'webview2'),
      };
    }
    const apiBaseUrl = await findFreeLoopbackApiBaseUrl();
    smokeApiReadyUrl = `${apiBaseUrl}/health/ready`;
    const smokeEnvironment = createSmokeEnvironment(process.env, apiBaseUrl, smokeDirectories);
    tauri = releaseMode
      ? runProcess(smokeExecutable, [], {
          cwd: explicitExecutable ? dirname(smokeExecutable) : tauriDir,
          env: smokeEnvironment,
        })
      : runProcess(
          'cargo',
          ['run', '--manifest-path', 'src-tauri/Cargo.toml', '--target-dir', '.tauri-target-smoke'],
          {
            cwd: tauriDir,
            env: smokeEnvironment,
          },
        );

    const exitCode = await waitForExit(tauri, 'Desktop Tauri smoke', 300000);

    if (exitCode !== 0) {
      throw new Error(`Tauri smoke exited with code ${exitCode}`);
    }
    assertSmokeEvidence(tauri.output, smokeDirectories.localDataDir);
    if (!existsSync(smokeDirectories.webviewDataDir)) {
      throw new Error(
        `Tauri smoke did not create its isolated WebView profile: ${smokeDirectories.webviewDataDir}`,
      );
    }

    console.log(`Desktop Tauri ${smokeLabel} smoke passed`);
  } catch (error) {
    failure = error;
  } finally {
    killProcessTree(tauri);
    killProcessTree(frontend);
    failure = await settleSmokeCleanup(failure, smokeApiReadyUrl, temporaryDataRoot);
  }
  if (failure) throw failure;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  await verifyTauriSmoke();
}
