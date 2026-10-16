import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import {
  assertSmokeBinaryCapability,
  assertSmokeEvidence,
  createSmokeEnvironment,
  findFreeLoopbackBaseUrl,
  killProcessTree,
  removeTemporaryDataRoot,
  settleSmokeCleanup,
  SMOKE_ISOLATION_PROTOCOL,
  verifiedSmokeExecutable,
  waitForExit,
} from './verify-tauri-smoke.mjs';

test('smoke environment points the host at its isolated directories', () => {
  const directories = {
    localDataDir: 'C:\\Temp\\storyforge-smoke\\local-data',
    configDir: 'C:\\Temp\\storyforge-smoke\\config',
    webviewDataDir: 'C:\\Temp\\storyforge-smoke\\webview2',
  };
  const environment = createSmokeEnvironment({ STORYFORGE_UNRELATED_VALUE: 'kept' }, directories);

  assert.equal(environment.NO_PROXY, '127.0.0.1,localhost,::1');
  assert.equal(environment.STORYFORGE_DESKTOP_SMOKE, '1');
  assert.equal(environment.STORYFORGE_DESKTOP_SMOKE_LOCAL_DATA_DIR, directories.localDataDir);
  assert.equal(environment.STORYFORGE_DESKTOP_SMOKE_CONFIG_DIR, directories.configDir);
  assert.equal(environment.STORYFORGE_SHADOW_GIT_SMOKE_CLEAR_PATH, '1');
  assert.equal(environment.WEBVIEW2_USER_DATA_FOLDER, directories.webviewDataDir);
  assert.equal(environment.STORYFORGE_UNRELATED_VALUE, 'kept');
});

test('smoke evidence requires a real marker inside the isolated data root', () => {
  const output = `Desktop Tauri smoke isolation: ${SMOKE_ISOLATION_PROTOCOL}\nDesktop Tauri smoke result: project=x, preview=first line\nsecond line, shadowRepositoryPath=\\\\?\\C:\\Temp\\smoke\\local-data\\shadow-git\\bucket\\repo\n`;
  assert.doesNotThrow(() => assertSmokeEvidence(output, 'C:\\Temp\\smoke\\local-data'));
  assert.throws(
    () =>
      assertSmokeEvidence(
        `Desktop Tauri smoke isolation: ${SMOKE_ISOLATION_PROTOCOL}\n`,
        'C:\\Temp\\smoke\\local-data',
      ),
    /without the smoke result marker/,
  );
  assert.throws(
    () =>
      assertSmokeEvidence(
        `Desktop Tauri smoke isolation: ${SMOKE_ISOLATION_PROTOCOL}\nDesktop Tauri smoke result: shadowRepositoryPath=C:\\Users\\author\\shadow-git\\repo\n`,
        'C:\\Temp\\smoke\\local-data',
      ),
    /escaped its isolated data root/,
  );
});

test('release smoke rejects a binary without the isolation protocol before launch', () => {
  assert.doesNotThrow(() =>
    assertSmokeBinaryCapability(Buffer.from(`prefix-${SMOKE_ISOLATION_PROTOCOL}-suffix`)),
  );
  assert.throws(
    () => assertSmokeBinaryCapability(Buffer.from('stale release executable')),
    /does not support isolated Tauri smoke/,
  );
});

test('installed smoke capability-checks the explicit executable before launch', () => {
  const explicitPath = 'C:\\Program Files\\StoryForge Smoke\\storyforge-desktop.exe';
  const checkedPaths = [];
  const readPaths = [];
  const selected = verifiedSmokeExecutable(
    explicitPath,
    'C:\\fallback\\storyforge-desktop.exe',
    (path) => {
      checkedPaths.push(path);
      return true;
    },
    (path) => {
      readPaths.push(path);
      return Buffer.from(`prefix-${SMOKE_ISOLATION_PROTOCOL}-suffix`);
    },
  );

  assert.equal(selected, explicitPath);
  assert.deepEqual(checkedPaths, [explicitPath]);
  assert.deepEqual(readPaths, [explicitPath]);

  let launched = false;
  assert.throws(() => {
    verifiedSmokeExecutable(
      explicitPath,
      '',
      () => true,
      () => Buffer.from('stale executable'),
    );
    launched = true;
  }, /does not support isolated Tauri smoke/);
  assert.equal(launched, false);
});

test('release smoke capability-checks the fallback executable before launch', () => {
  const fallbackPath = 'C:\\release\\storyforge-desktop.exe';
  const checkedPaths = [];
  const readPaths = [];
  const selected = verifiedSmokeExecutable(
    '',
    fallbackPath,
    (path) => {
      checkedPaths.push(path);
      return true;
    },
    (path) => {
      readPaths.push(path);
      return Buffer.from(`prefix-${SMOKE_ISOLATION_PROTOCOL}-suffix`);
    },
  );

  assert.equal(selected, fallbackPath);
  assert.deepEqual(checkedPaths, [fallbackPath]);
  assert.deepEqual(readPaths, [fallbackPath]);
});

test('Windows cleanup synchronously terminates a live process tree', () => {
  const calls = [];
  killProcessTree({ pid: 4242, exitCode: null }, 'win32', (command, args, options) =>
    calls.push({ command, args, options }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'taskkill.exe');
  assert.deepEqual(calls[0].args, ['/PID', '4242', '/T', '/F']);
  assert.equal(calls[0].options.windowsHide, true);

  killProcessTree({ pid: 4343, exitCode: 1 }, 'win32', (command, args, options) =>
    calls.push({ command, args, options }),
  );
  assert.equal(calls.length, 1, 'an exited PID must not be targeted after it can be reused');

  killProcessTree(
    { pid: 4444, exitCode: null, signalCode: 'SIGTERM' },
    'win32',
    (command, args, options) => calls.push({ command, args, options }),
  );
  assert.equal(calls.length, 1, 'a signal-exited PID must not be targeted after it can be reused');
});

test('process wait rejects signal termination instead of reporting success', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.output = '';

  const exit = waitForExit(child, 'test child', 1000);
  child.emit('exit', null, 'SIGTERM');

  await assert.rejects(exit, /test child terminated by signal SIGTERM/);
});

test('cleanup removes the temporary data root and aggregates a removal failure', async () => {
  const removals = [];
  assert.equal(
    await removeTemporaryDataRoot('C:\\Temp\\smoke-data', async (...args) => {
      removals.push(args);
    }),
    true,
  );
  assert.equal(removals.length, 1);
  assert.equal(removals[0][0], 'C:\\Temp\\smoke-data');
  assert.equal(removals[0][1].recursive, true);
  assert.equal(await removeTemporaryDataRoot(''), false);

  const primaryError = new Error('smoke failed');
  const removeError = new Error('data root busy');
  const failure = await settleSmokeCleanup(primaryError, 'C:\\Temp\\smoke-data', async () => {
    throw removeError;
  });
  assert.ok(failure instanceof AggregateError);
  assert.deepEqual(failure.errors, [primaryError, removeError]);
  assert.equal(failure.message, 'Tauri smoke or data cleanup failed');
  assert.equal(await settleSmokeCleanup(primaryError, ''), primaryError);
});

test('free loopback port is ephemeral', async () => {
  const baseUrl = new URL(await findFreeLoopbackBaseUrl());
  const port = Number(baseUrl.port);

  assert.equal(baseUrl.protocol, 'http:');
  assert.equal(baseUrl.hostname, '127.0.0.1');
  assert.equal(Number.isInteger(port) && port > 0 && port <= 65535, true);
});
test('smoke environment bypasses proxies only for loopback and preserves inherited bypasses', () => {
  const inherited = {
    HTTPS_PROXY: 'http://proxy.example:8080',
    NO_PROXY: 'internal.example, localhost',
    no_proxy: 'second.internal,127.0.0.1',
  };
  const before = { ...inherited };
  const environment = createSmokeEnvironment(inherited, {
    localDataDir: 'C:\\Temp\\smoke\\local-data',
    configDir: 'C:\\Temp\\smoke\\config',
    webviewDataDir: 'C:\\Temp\\smoke\\webview2',
  });
  assert.deepEqual(
    new Set(environment.NO_PROXY.split(',')),
    new Set(['internal.example', 'localhost', 'second.internal', '127.0.0.1', '::1']),
  );
  assert.equal(environment.HTTPS_PROXY, inherited.HTTPS_PROXY);
  assert.equal(
    'no_proxy' in environment,
    false,
    'Windows case-insensitive environment must receive a single NO_PROXY key',
  );
  assert.deepEqual(inherited, before, 'parent process environment must not be mutated');
});
