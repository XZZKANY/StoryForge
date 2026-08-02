import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  aggregateFailures,
  assertCleanTestIdentity,
  assertSafeTestPath,
  createVerificationLayout,
  PRODUCTION_PRODUCT_NAME,
  runProcess,
  selectOwnedProcessIds,
  TEST_IDENTIFIER,
  TEST_PRODUCT_NAME,
  treeDigest,
} from './verify-nsis-install.mjs';

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test('verification layout keeps test install, registry, and app data separate from production', () => {
  const layout = createVerificationLayout(
    {
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
      APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
      USERPROFILE: 'C:\\Users\\tester',
    },
    'D:\\Redirected Desktop',
  );

  assert.equal(layout.installDir.endsWith(TEST_PRODUCT_NAME), true);
  assert.equal(layout.appLocalDataDir.endsWith(TEST_IDENTIFIER), true);
  assert.equal(layout.appConfigDir.endsWith(TEST_IDENTIFIER), true);
  assert.equal(layout.webviewDataDir, resolve(layout.appLocalDataDir, 'webview2'));
  assert.equal(layout.shadowDataDir, resolve(layout.appLocalDataDir, 'shadow-git'));
  assert.notEqual(layout.installDir, layout.productionInstallDir);
  assert.notEqual(layout.testRegistryKey, layout.productionRegistryKey);
  assert.equal(
    layout.testShortcuts.includes(resolve('D:\\Redirected Desktop', `${TEST_PRODUCT_NAME}.lnk`)),
    true,
  );
});

test('pre-existing test shortcut directory blocks install smoke before cleanup owns it', async () => {
  const layout = createVerificationLayout({
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
    APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
    USERPROFILE: 'C:\\Users\\tester',
  });

  await assert.rejects(
    assertCleanTestIdentity(
      layout,
      async (path) => path === layout.testShortcutDirectory,
      async () => null,
    ),
    /Install-smoke identity already exists/,
  );
});

test('path guard accepts only the exact test child and rejects production or sibling paths', () => {
  const parent = 'C:\\Users\\tester\\AppData\\Local';
  assert.equal(
    assertSafeTestPath(parent, resolve(parent, TEST_PRODUCT_NAME), TEST_PRODUCT_NAME),
    resolve(parent, TEST_PRODUCT_NAME),
  );
  assert.throws(
    () =>
      assertSafeTestPath(parent, resolve(parent, PRODUCTION_PRODUCT_NAME), PRODUCTION_PRODUCT_NAME),
    /production product name/,
  );
  assert.throws(
    () =>
      assertSafeTestPath(parent, resolve(parent, `${TEST_PRODUCT_NAME}-other`), TEST_PRODUCT_NAME),
    /Refusing to manage non-test path/,
  );
});

test('owned process filter selects only executable paths below the fixed test install directory', () => {
  const localAppData = 'C:\\Users\\tester\\AppData\\Local';
  const installDir = `${localAppData}\\${TEST_PRODUCT_NAME}`;
  const productionInstallDir = `${localAppData}\\${PRODUCTION_PRODUCT_NAME}`;

  assert.deepEqual(
    selectOwnedProcessIds(
      [
        { ProcessId: 101, ExecutablePath: `${installDir}\\storyforge-desktop.exe` },
        { ProcessId: 102, ExecutablePath: `${installDir}\\resources\\storyforge-api.exe` },
        {
          ProcessId: 103,
          ExecutablePath: `${productionInstallDir}\\storyforge-desktop.exe`,
        },
        {
          ProcessId: 104,
          ExecutablePath: `${installDir}-other\\storyforge-desktop.exe`,
        },
        { ProcessId: 105, ExecutablePath: installDir },
        { ProcessId: 106, ExecutablePath: null },
        { ProcessId: '107', ExecutablePath: `${installDir}\\storyforge-desktop.exe` },
      ],
      installDir.toUpperCase(),
    ),
    [101, 102],
  );
});

test('failure aggregation preserves the original smoke error first', () => {
  const smokeError = new Error('installed smoke failed');
  const cleanupError = new Error('cleanup failed');
  const productionError = new Error('production snapshot failed');

  assert.equal(aggregateFailures([], 'failure'), undefined);
  assert.equal(aggregateFailures([smokeError], 'failure'), smokeError);
  const failure = aggregateFailures(
    [smokeError, cleanupError, productionError],
    'NSIS verification failed',
  );
  assert.ok(failure instanceof AggregateError);
  assert.deepEqual(failure.errors, [smokeError, cleanupError, productionError]);
});

test('process runner rejects signal termination instead of reporting success', async () => {
  const child = new EventEmitter();
  const spawnProcess = () => {
    Promise.resolve().then(() => child.emit('exit', null, 'SIGTERM'));
    return child;
  };

  await assert.rejects(
    runProcess('installer.exe', ['/S'], {}, spawnProcess),
    /installer\.exe \/S terminated by signal SIGTERM/,
  );
});

test('treeDigest changes with file content and ignores timestamps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storyforge-install-smoke-test-'));
  tempDirs.push(root);
  await mkdir(join(root, 'resources'), { recursive: true });
  await writeFile(join(root, 'resources', 'manifest.json'), 'first');
  const first = await treeDigest(root);
  const identical = await treeDigest(root);
  assert.equal(first, identical);

  await writeFile(join(root, 'resources', 'manifest.json'), 'second');
  assert.notEqual(await treeDigest(root), first);
});
