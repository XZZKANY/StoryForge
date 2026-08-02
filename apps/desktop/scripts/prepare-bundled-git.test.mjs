import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  assertSupportedHost,
  ensureCachedArchive,
  validateManifest,
  verifyRuntime,
} from './prepare-bundled-git.mjs';

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDir() {
  const path = await mkdtemp(join(tmpdir(), 'storyforge-mingit-test-'));
  tempDirs.push(path);
  return path;
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function manifest(overrides = {}) {
  const asset = 'MinGit-fixture.zip';
  return validateManifest({
    schemaVersion: 1,
    platform: 'win32',
    architecture: 'x64',
    version: '2.55.0.windows.3',
    asset,
    url: `https://github.com/example/releases/${asset}`,
    sha256: digest('fixture archive'),
    executable: 'cmd/git.exe',
    licenseFiles: ['LICENSE.txt'],
    licenseDirectories: ['share/licenses'],
    ...overrides,
  });
}

test('validateManifest rejects an invalid digest', () => {
  assert.throws(() => manifest({ sha256: 'not-a-digest' }), /sha256/);
});

test('assertSupportedHost rejects a different target architecture', () => {
  assert.doesNotThrow(() => assertSupportedHost(manifest(), 'win32', 'x64'));
  assert.throws(
    () => assertSupportedHost(manifest(), 'win32', 'arm64'),
    /targets win32\/x64, current host is win32\/arm64/,
  );
});

test('ensureCachedArchive verifies a cache hit without downloading again', async () => {
  const cache = await tempDir();
  const value = manifest();
  await writeFile(join(cache, value.asset), 'fixture archive');
  let downloads = 0;

  const result = await ensureCachedArchive(value, cache, async () => {
    downloads += 1;
  });

  assert.equal(result.cacheHit, true);
  assert.equal(downloads, 0);
});

test('ensureCachedArchive deletes a download with the wrong digest', async () => {
  const cache = await tempDir();
  const value = manifest();

  await assert.rejects(
    ensureCachedArchive(value, cache, async (_url, destination) => {
      await writeFile(destination, 'tampered archive');
    }),
    /SHA-256 mismatch/,
  );
  await assert.rejects(readFile(join(cache, value.asset)), /ENOENT/);
});

test('verifyRuntime reports a missing executable', async () => {
  const runtime = await tempDir();
  await assert.rejects(verifyRuntime(manifest(), runtime), /executable is missing/);
});

test('verifyRuntime rejects a wrong Git version and requires licenses', async () => {
  const runtime = await tempDir();
  await mkdir(join(runtime, 'cmd'), { recursive: true });
  await mkdir(join(runtime, 'share', 'licenses'), { recursive: true });
  await writeFile(join(runtime, 'cmd', 'git.exe'), 'fixture');
  await writeFile(join(runtime, 'LICENSE.txt'), 'GPL-2.0');
  await writeFile(join(runtime, 'share', 'licenses', 'dependency.txt'), 'license');

  await assert.rejects(
    verifyRuntime(manifest(), runtime, async () => 'git version 0.0.0'),
    /version mismatch/,
  );

  const verified = await verifyRuntime(
    manifest(),
    runtime,
    async () => 'git version 2.55.0.windows.3',
  );
  assert.equal(verified.reportedVersion, 'git version 2.55.0.windows.3');
});

test('verifyRuntime rejects missing license files and directories', async () => {
  const runtime = await tempDir();
  await mkdir(join(runtime, 'cmd'), { recursive: true });
  await writeFile(join(runtime, 'cmd', 'git.exe'), 'fixture');
  const runGit = async () => 'git version 2.55.0.windows.3';

  await assert.rejects(verifyRuntime(manifest(), runtime, runGit), /license file is missing/);

  await writeFile(join(runtime, 'LICENSE.txt'), 'GPL-2.0');
  await assert.rejects(verifyRuntime(manifest(), runtime, runGit), /license directory is missing/);

  await mkdir(join(runtime, 'share', 'licenses'), { recursive: true });
  await assert.rejects(verifyRuntime(manifest(), runtime, runGit), /license directory is empty/);
});
