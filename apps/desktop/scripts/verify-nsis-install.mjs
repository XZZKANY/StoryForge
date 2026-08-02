import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TEST_PRODUCT_NAME = 'StoryForge Shadow Git Install Smoke';
export const TEST_IDENTIFIER = 'com.storyforge.ide.shadow-git-install-smoke';
export const PRODUCTION_PRODUCT_NAME = 'StoryForge IDE';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const tauriDir = resolve(desktopDir, 'src-tauri');
const targetDir = resolve(desktopDir, '.tauri-target-install-smoke');
const overlayConfig = resolve(tauriDir, 'tauri.install-smoke.conf.json');
const tauriCli = resolve(desktopDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const smokeScript = resolve(scriptDir, 'verify-tauri-smoke.mjs');

function requiredEnvironment(environment, key) {
  const value = environment[key];
  if (!value) throw new Error(`Required environment variable is missing: ${key}`);
  return resolve(value);
}

export function createVerificationLayout(environment = process.env, desktopPath) {
  const localAppData = requiredEnvironment(environment, 'LOCALAPPDATA');
  const appData = requiredEnvironment(environment, 'APPDATA');
  const userProfile = requiredEnvironment(environment, 'USERPROFILE');
  const programs = resolve(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const desktop = resolve(desktopPath ?? resolve(userProfile, 'Desktop'));
  const appLocalDataDir = resolve(localAppData, TEST_IDENTIFIER);
  const appConfigDir = resolve(appData, TEST_IDENTIFIER);
  const testShortcutDirectory = resolve(programs, TEST_PRODUCT_NAME);
  return {
    localAppData,
    appData,
    userProfile,
    installDir: resolve(localAppData, TEST_PRODUCT_NAME),
    appLocalDataDir,
    appConfigDir,
    webviewDataDir: resolve(appLocalDataDir, 'webview2'),
    shadowDataDir: resolve(appLocalDataDir, 'shadow-git'),
    productionInstallDir: resolve(localAppData, PRODUCTION_PRODUCT_NAME),
    testRegistryKey: `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${TEST_PRODUCT_NAME}`,
    productionRegistryKey: `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCTION_PRODUCT_NAME}`,
    testShortcutDirectory,
    testShortcuts: [
      resolve(programs, `${TEST_PRODUCT_NAME}.lnk`),
      resolve(testShortcutDirectory, `${TEST_PRODUCT_NAME}.lnk`),
      resolve(desktop, `${TEST_PRODUCT_NAME}.lnk`),
    ],
    productionShortcuts: [
      resolve(programs, `${PRODUCTION_PRODUCT_NAME}.lnk`),
      resolve(programs, PRODUCTION_PRODUCT_NAME, `${PRODUCTION_PRODUCT_NAME}.lnk`),
      resolve(desktop, `${PRODUCTION_PRODUCT_NAME}.lnk`),
    ],
  };
}

export function assertSafeTestPath(parent, candidate, expectedName) {
  const expected = resolve(parent, expectedName);
  const actual = resolve(candidate);
  if (actual !== expected) {
    throw new Error(`Refusing to manage non-test path: expected ${expected}, received ${actual}`);
  }
  if (expectedName === PRODUCTION_PRODUCT_NAME) {
    throw new Error('Refusing to use the production product name as a test path');
  }
  return actual;
}

function isExecutableUnderInstallDir(installDir, executablePath) {
  if (typeof executablePath !== 'string' || executablePath.length === 0) return false;
  const relativePath = win32.relative(win32.resolve(installDir), win32.resolve(executablePath));
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${win32.sep}`) &&
    !win32.isAbsolute(relativePath)
  );
}

export function selectOwnedProcessIds(processes, installDir) {
  return processes
    .filter(
      (processInfo) =>
        Number.isInteger(processInfo.ProcessId) &&
        processInfo.ProcessId > 0 &&
        isExecutableUnderInstallDir(installDir, processInfo.ExecutablePath),
    )
    .map((processInfo) => processInfo.ProcessId);
}

export function aggregateFailures(failures, message) {
  if (failures.length === 0) return undefined;
  if (failures.length === 1) return failures[0];
  return new AggregateError(failures, message);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runProcess(command, args, options = {}, spawnProcess = spawn) {
  const child = spawnProcess(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  if (options.capture) {
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
  }
  const code = await new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('exit', (exitCode, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} terminated by signal ${signal}`.trim()));
        return;
      }
      resolvePromise(exitCode ?? 1);
    });
  });
  const allowedCodes = options.allowedCodes ?? [0];
  if (!allowedCodes.includes(code)) {
    throw new Error(
      `${command} ${args.join(' ')} exited with code ${code}\n${stderr || stdout}`.trim(),
    );
  }
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function listWindowsProcesses() {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    '@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId, ExecutablePath) | ConvertTo-Json -Compress',
  ].join('; ');
  const result = await runProcess(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { capture: true },
  );
  if (!result.stdout) return [];
  const processes = JSON.parse(result.stdout);
  return Array.isArray(processes) ? processes : [processes];
}

async function windowsKnownDesktopPath() {
  const result = await runProcess(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)',
    ],
    { capture: true },
  );
  if (!result.stdout) throw new Error('Windows Desktop known folder resolved to an empty path');
  return result.stdout;
}

async function terminateOwnedInstallProcesses(layout) {
  const installDir = assertSafeTestPath(layout.localAppData, layout.installDir, TEST_PRODUCT_NAME);
  const processIds = selectOwnedProcessIds(await listWindowsProcesses(), installDir);
  for (const processId of processIds) {
    await runProcess('taskkill.exe', ['/F', '/PID', String(processId)], {
      capture: true,
      allowedCodes: [0, 128],
    });
  }
}

async function waitFor(predicate, label, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function registryValue(key) {
  const result = await runProcess('reg.exe', ['query', key, '/s'], {
    capture: true,
    allowedCodes: [0, 1],
  });
  return result.code === 0 ? result.stdout.replace(/\r\n/g, '\n') : null;
}

async function fileDigest(path) {
  if (!(await exists(path))) return null;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function listTree(root, directory = root) {
  const items = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      items.push({ kind: 'directory', path: relativePath });
      items.push(...(await listTree(root, path)));
    } else if (entry.isFile()) {
      items.push({
        kind: 'file',
        path: relativePath,
        bytes: (await stat(path)).size,
        sha256: await fileDigest(path),
      });
    } else {
      items.push({ kind: 'other', path: relativePath });
    }
  }
  return items;
}

export async function treeDigest(root) {
  if (!(await exists(root))) return null;
  const tree = await listTree(root);
  return createHash('sha256').update(JSON.stringify(tree)).digest('hex');
}

async function snapshotProduction(layout) {
  const shortcuts = {};
  for (const path of layout.productionShortcuts) shortcuts[path] = await fileDigest(path);
  return {
    installTree: await treeDigest(layout.productionInstallDir),
    registry: await registryValue(layout.productionRegistryKey),
    shortcuts,
  };
}

export async function assertCleanTestIdentity(
  layout,
  pathExists = exists,
  registryReader = registryValue,
) {
  const occupied = [];
  for (const path of [
    layout.installDir,
    layout.appLocalDataDir,
    layout.appConfigDir,
    layout.testShortcutDirectory,
    ...layout.testShortcuts,
  ]) {
    if (await pathExists(path)) occupied.push(path);
  }
  if (await registryReader(layout.testRegistryKey)) occupied.push(layout.testRegistryKey);
  if (occupied.length > 0) {
    throw new Error(
      `Install-smoke identity already exists; refusing to overwrite:\n${occupied.join('\n')}`,
    );
  }
}

async function findInstaller() {
  const directory = resolve(targetDir, 'release', 'bundle', 'nsis');
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(`${TEST_PRODUCT_NAME}_`) &&
        entry.name.endsWith('_x64-setup.exe'),
    )
    .map((entry) => resolve(directory, entry.name));
  assert.equal(matches.length, 1, `Expected one isolated NSIS installer, found ${matches.length}`);
  return matches[0];
}

async function countFiles(path) {
  const entries = await listTree(path);
  return entries.filter((entry) => entry.kind === 'file').length;
}

async function verifyInstalledResources(layout) {
  const resourceRoot = resolve(layout.installDir, 'resources', 'mingit');
  const manifestPath = resolve(resourceRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.version, '2.55.0.windows.3');
  assert.equal(manifest.platform, 'win32');
  assert.equal(manifest.architecture, 'x64');
  const git = resolve(resourceRoot, 'runtime', manifest.executable);
  const version = await runProcess(git, ['--version'], {
    capture: true,
    env: { ...process.env, PATH: '' },
  });
  assert.equal(version.stdout, 'git version 2.55.0.windows.3');
  for (const license of manifest.licenseFiles) {
    assert.ok((await stat(resolve(resourceRoot, 'runtime', license))).size > 0);
  }
  for (const licenseDirectory of manifest.licenseDirectories) {
    assert.ok((await countFiles(resolve(resourceRoot, 'runtime', licenseDirectory))) > 0);
  }
  const executable = resolve(layout.installDir, 'storyforge-desktop.exe');
  const uninstaller = resolve(layout.installDir, 'uninstall.exe');
  assert.ok((await stat(executable)).isFile());
  assert.ok((await stat(uninstaller)).isFile());
  return { executable, uninstaller, git, manifestPath, gitVersion: version.stdout };
}

async function buildIsolatedInstaller() {
  await runProcess(
    process.execPath,
    [tauriCli, 'build', '--ci', '--bundles', 'nsis', '--config', overlayConfig],
    {
      cwd: desktopDir,
      env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    },
  );
}

async function removeExactFile(path) {
  await rm(path, { force: true });
}

async function removeEmptyDirectory(path) {
  try {
    await rmdir(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function cleanupOwnedTestIdentity(layout) {
  assertSafeTestPath(layout.localAppData, layout.installDir, TEST_PRODUCT_NAME);
  assertSafeTestPath(layout.localAppData, layout.appLocalDataDir, TEST_IDENTIFIER);
  assertSafeTestPath(layout.appData, layout.appConfigDir, TEST_IDENTIFIER);
  await terminateOwnedInstallProcesses(layout);
  const uninstaller = resolve(layout.installDir, 'uninstall.exe');
  if (await exists(uninstaller)) {
    await runProcess(uninstaller, ['/S'], { allowedCodes: [0] }).catch(() => undefined);
    await waitFor(
      () => exists(layout.installDir).then((value) => !value),
      'test uninstall cleanup',
    ).catch(() => undefined);
  }
  await terminateOwnedInstallProcesses(layout);
  await rm(layout.installDir, { recursive: true, force: true });
  await rm(layout.appLocalDataDir, { recursive: true, force: true });
  await rm(layout.appConfigDir, { recursive: true, force: true });
  for (const shortcut of layout.testShortcuts) await removeExactFile(shortcut);
  await removeEmptyDirectory(layout.testShortcutDirectory);
  await runProcess('reg.exe', ['delete', layout.testRegistryKey, '/f'], {
    capture: true,
    allowedCodes: [0, 1],
  });
}

export async function verifyNsisInstall({ build = false } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(
      `NSIS install smoke requires win32/x64, received ${process.platform}/${process.arch}`,
    );
  }
  const layout = createVerificationLayout(process.env, await windowsKnownDesktopPath());
  assert.notEqual(layout.installDir, layout.productionInstallDir);
  assert.notEqual(layout.testRegistryKey, layout.productionRegistryKey);
  const productionBefore = await snapshotProduction(layout);
  await assertCleanTestIdentity(layout);
  let ownsTestIdentity = false;
  let evidence;
  const failures = [];

  try {
    if (build) await buildIsolatedInstaller();
    const installer = await findInstaller();
    ownsTestIdentity = true;
    await runProcess(installer, ['/S']);
    await waitFor(() => exists(resolve(layout.installDir, 'uninstall.exe')), 'silent install');
    const installed = await verifyInstalledResources(layout);
    const registry = await registryValue(layout.testRegistryKey);
    assert.match(registry ?? '', /StoryForge Shadow Git Install Smoke/);
    const installedShortcuts = [];
    for (const shortcut of layout.testShortcuts) {
      if (await exists(shortcut)) installedShortcuts.push(shortcut);
    }
    assert.ok(installedShortcuts.length > 0, 'silent install must create a shortcut');

    await runProcess(
      process.execPath,
      [
        smokeScript,
        '--executable',
        installed.executable,
        '--local-data-dir',
        layout.appLocalDataDir,
        '--config-dir',
        layout.appConfigDir,
        '--webview-data-dir',
        layout.webviewDataDir,
      ],
      { cwd: desktopDir },
    );
    assert.ok(await exists(layout.appLocalDataDir), 'installed smoke must create app-local data');
    assert.ok(await exists(layout.shadowDataDir), 'installed smoke must create shadow Git data');
    const shadowDataDigest = await treeDigest(layout.shadowDataDir);

    await terminateOwnedInstallProcesses(layout);
    await runProcess(installed.uninstaller, ['/S']);
    await waitFor(async () => {
      if (await exists(layout.installDir)) return false;
      if (await registryValue(layout.testRegistryKey)) return false;
      for (const shortcut of layout.testShortcuts) {
        if (await exists(shortcut)) return false;
      }
      return true;
    }, 'silent uninstall cleanup');
    assert.equal(await registryValue(layout.testRegistryKey), null);
    for (const shortcut of layout.testShortcuts) assert.equal(await exists(shortcut), false);
    assert.equal(await exists(installed.git), false);
    assert.equal(await exists(installed.manifestPath), false);
    assert.ok(
      await exists(layout.shadowDataDir),
      'uninstall must preserve app-local shadow Git data',
    );
    assert.equal(
      await treeDigest(layout.shadowDataDir),
      shadowDataDigest,
      'uninstall must preserve app-local shadow Git data byte-for-byte',
    );

    evidence = {
      installer,
      installedGitVersion: installed.gitVersion,
      installedShortcuts,
      shadowDataDigest,
      installDirectoryRemoved: true,
      uninstallRegistryRemoved: true,
      productionInstallDigest: productionBefore.installTree,
    };
  } catch (error) {
    failures.push(error);
  } finally {
    if (ownsTestIdentity) {
      try {
        await cleanupOwnedTestIdentity(layout);
      } catch (error) {
        failures.push(error);
      }
    }
  }

  try {
    const productionAfter = await snapshotProduction(layout);
    assert.deepEqual(productionAfter, productionBefore, 'production installation changed');
  } catch (error) {
    failures.push(error);
  }
  const failure = aggregateFailures(failures, 'NSIS smoke, cleanup, or production guard failed');
  if (failure) throw failure;
  console.log(`Isolated NSIS install smoke passed\n${JSON.stringify(evidence, null, 2)}`);
  return evidence;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  await verifyNsisInstall({ build: process.argv.includes('--build') });
}
