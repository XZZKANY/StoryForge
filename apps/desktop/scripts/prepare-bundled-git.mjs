import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const repoRoot = resolve(desktopDir, '..', '..');
const manifestPath = resolve(desktopDir, 'src-tauri', 'resources', 'mingit', 'manifest.json');
const runtimeDir = resolve(desktopDir, 'src-tauri', 'resources', 'mingit', 'runtime');
const cacheDir = resolve(repoRoot, '.cache', 'mingit');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`MinGit manifest field ${field} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`MinGit manifest field ${field} must be a non-empty string array`);
  }
  return value.map((entry, index) => requireString(entry, `${field}[${index}]`));
}

function validateRelativeResourcePath(value, field) {
  const normalized = value.replace(/\\/g, '/');
  if (
    isAbsolute(value) ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`MinGit manifest field ${field} must be a safe relative path`);
  }
  return normalized;
}

export function validateManifest(value) {
  if (!isRecord(value)) throw new Error('MinGit manifest must be a JSON object');
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported MinGit manifest schemaVersion: ${String(value.schemaVersion)}`);
  }

  const platform = requireString(value.platform, 'platform');
  const architecture = requireString(value.architecture, 'architecture');
  const version = requireString(value.version, 'version');
  const asset = validateRelativeResourcePath(requireString(value.asset, 'asset'), 'asset');
  const url = requireString(value.url, 'url');
  const sha256 = requireString(value.sha256, 'sha256').toLowerCase();
  const executable = validateRelativeResourcePath(
    requireString(value.executable, 'executable'),
    'executable',
  );
  const licenseFiles = requireStringArray(value.licenseFiles, 'licenseFiles').map((entry, index) =>
    validateRelativeResourcePath(entry, `licenseFiles[${index}]`),
  );
  const licenseDirectories = requireStringArray(value.licenseDirectories, 'licenseDirectories').map(
    (entry, index) => validateRelativeResourcePath(entry, `licenseDirectories[${index}]`),
  );

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('MinGit manifest URL is invalid');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'github.com') {
    throw new Error('MinGit manifest URL must use HTTPS on github.com');
  }
  if (!parsedUrl.pathname.endsWith(`/${asset}`)) {
    throw new Error('MinGit manifest URL must end with the pinned asset name');
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('MinGit manifest sha256 must be 64 lowercase hexadecimal characters');
  }

  return {
    schemaVersion: 1,
    platform,
    architecture,
    version,
    asset,
    url,
    sha256,
    executable,
    licenseFiles,
    licenseDirectories,
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  await pipeline(
    createReadStream(path),
    new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    }),
    new Transform({
      transform(_chunk, _encoding, callback) {
        callback();
      },
    }),
  );
  return hash.digest('hex');
}

export async function downloadFile(url, destination, fetchImpl = fetch) {
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.partial-${process.pid}-${Date.now()}`;
  const hash = createHash('sha256');
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'StoryForge-bundled-git-preparer' },
      signal: globalThis.AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`MinGit download failed with HTTP ${response.status}`);
    }
    const hashingStream = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      hashingStream,
      createWriteStream(partial, { flags: 'wx' }),
    );
    await rename(partial, destination);
    return hash.digest('hex');
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

export async function ensureCachedArchive(manifest, targetCacheDir, downloader = downloadFile) {
  await mkdir(targetCacheDir, { recursive: true });
  const archivePath = resolve(targetCacheDir, manifest.asset);
  if (await exists(archivePath)) {
    const digest = await sha256File(archivePath);
    if (digest === manifest.sha256) {
      return { archivePath, cacheHit: true };
    }
    await rm(archivePath, { force: true });
  }

  await downloader(manifest.url, archivePath);
  const digest = await sha256File(archivePath);
  if (digest !== manifest.sha256) {
    await rm(archivePath, { force: true });
    throw new Error(`MinGit SHA-256 mismatch: expected ${manifest.sha256}, received ${digest}`);
  }
  return { archivePath, cacheHit: false };
}

export async function verifyArchive(manifest, archivePath) {
  if (!(await exists(archivePath))) {
    throw new Error(`MinGit archive is missing: ${archivePath}`);
  }
  const digest = await sha256File(archivePath);
  if (digest !== manifest.sha256) {
    throw new Error(`MinGit SHA-256 mismatch: expected ${manifest.sha256}, received ${digest}`);
  }
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function directoryContainsFile(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && (await directoryContainsFile(join(path, entry.name)))) return true;
  }
  return false;
}

export async function verifyRuntime(manifest, targetRuntimeDir, runGit = run) {
  const executablePath = resolve(targetRuntimeDir, manifest.executable);
  let executableStat;
  try {
    executableStat = await stat(executablePath);
  } catch {
    throw new Error(`Bundled Git executable is missing: ${executablePath}`);
  }
  if (!executableStat.isFile()) {
    throw new Error(`Bundled Git executable is not a file: ${executablePath}`);
  }

  const reportedVersion = await runGit(executablePath, ['--version']);
  const expectedVersion = `git version ${manifest.version}`;
  if (reportedVersion.trim() !== expectedVersion) {
    throw new Error(
      `Bundled Git version mismatch: expected "${expectedVersion}", received "${reportedVersion.trim()}"`,
    );
  }

  for (const licenseFile of manifest.licenseFiles) {
    const path = resolve(targetRuntimeDir, licenseFile);
    let fileStat;
    try {
      fileStat = await stat(path);
    } catch {
      throw new Error(`Bundled Git license file is missing: ${licenseFile}`);
    }
    if (!fileStat.isFile() || fileStat.size === 0) {
      throw new Error(`Bundled Git license file is empty or invalid: ${licenseFile}`);
    }
  }
  for (const licenseDirectory of manifest.licenseDirectories) {
    const path = resolve(targetRuntimeDir, licenseDirectory);
    try {
      if (!(await directoryContainsFile(path))) {
        throw new Error(`Bundled Git license directory is empty: ${licenseDirectory}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('license directory is empty')) {
        throw error;
      }
      throw new Error(`Bundled Git license directory is missing: ${licenseDirectory}`, {
        cause: error,
      });
    }
  }

  return { executablePath, reportedVersion };
}

function quotePowerShellLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function assertManagedDirectory(parent, candidate) {
  const rel = relative(parent, candidate);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new Error(`Refusing to manage directory outside ${parent}: ${candidate}`);
  }
}

export async function extractArchive(manifest, archivePath, targetRuntimeDir) {
  if (process.platform !== 'win32') {
    throw new Error('The pinned MinGit runtime can only be prepared on Windows');
  }
  const parent = dirname(targetRuntimeDir);
  const stagingRoot = await mkdtemp(resolve(parent, '.runtime-staging-'));
  const staging = resolve(stagingRoot, 'runtime');
  const backup = resolve(parent, `.runtime-backup-${process.pid}-${Date.now()}`);
  assertManagedDirectory(parent, stagingRoot);
  assertManagedDirectory(parent, backup);

  let movedExisting = false;
  try {
    await mkdir(staging, { recursive: true });
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Expand-Archive -LiteralPath ${quotePowerShellLiteral(archivePath)} -DestinationPath ${quotePowerShellLiteral(staging)} -Force`,
    ].join('; ');
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
    await verifyRuntime(manifest, staging);

    if (await exists(targetRuntimeDir)) {
      await rename(targetRuntimeDir, backup);
      movedExisting = true;
    }
    await rename(staging, targetRuntimeDir);
    await writeFile(resolve(targetRuntimeDir, '.gitkeep'), '');
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedExisting && !(await exists(targetRuntimeDir)) && (await exists(backup))) {
      await rename(backup, targetRuntimeDir);
    }
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
    if (await exists(backup)) await rm(backup, { recursive: true, force: true });
  }
}

export function assertSupportedHost(
  manifest,
  platform = process.platform,
  architecture = process.arch,
) {
  if (platform !== manifest.platform || architecture !== manifest.architecture) {
    throw new Error(
      `MinGit ${manifest.version} targets ${manifest.platform}/${manifest.architecture}, current host is ${platform}/${architecture}`,
    );
  }
}

export async function prepareBundledGit({ verifyOnly = false } = {}) {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  assertSupportedHost(manifest);
  const archivePath = resolve(cacheDir, manifest.asset);

  if (verifyOnly) {
    await verifyArchive(manifest, archivePath);
    const runtime = await verifyRuntime(manifest, runtimeDir);
    console.log(`Bundled Git verified: ${runtime.reportedVersion} (${runtime.executablePath})`);
    return runtime;
  }

  const archive = await ensureCachedArchive(manifest, cacheDir);
  try {
    const runtime = await verifyRuntime(manifest, runtimeDir);
    console.log(
      `Bundled Git ready: ${runtime.reportedVersion} (${archive.cacheHit ? 'verified cache' : 'downloaded'})`,
    );
    return runtime;
  } catch (error) {
    console.log(`Preparing bundled Git runtime: ${error instanceof Error ? error.message : error}`);
  }

  await extractArchive(manifest, archive.archivePath, runtimeDir);
  const runtime = await verifyRuntime(manifest, runtimeDir);
  console.log(
    `Bundled Git ready: ${runtime.reportedVersion} (${archive.cacheHit ? 'verified cache' : 'downloaded'})`,
  );
  return runtime;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  await prepareBundledGit({ verifyOnly: process.argv.includes('--verify') });
}
