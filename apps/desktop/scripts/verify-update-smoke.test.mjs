import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CANDIDATE_VERSION,
  SMOKE_PORT,
  localManifest,
  parseProbeLog,
  updateSmokeOverlay,
} from './verify-update-smoke.mjs';
import { TEST_IDENTIFIER } from './verify-nsis-install.mjs';

const tauriDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri');
const readJson = async (name) => JSON.parse(await readFile(resolve(tauriDir, name), 'utf8'));

test('升级冒烟的配置叠在隔离测试身份上，本机明文清单只在这里打开', async () => {
  const installSmoke = await readJson('tauri.install-smoke.conf.json');
  const overlay = updateSmokeOverlay(installSmoke, { version: '0.0.1', pubkey: 'PUB' });
  assert.equal(overlay.identifier, TEST_IDENTIFIER);
  assert.equal(overlay.productName, installSmoke.productName);
  assert.equal(overlay.version, '0.0.1');
  assert.deepEqual(overlay.bundle, { targets: ['nsis'], createUpdaterArtifacts: true });
  assert.deepEqual(overlay.plugins.updater, {
    pubkey: 'PUB',
    endpoints: [`http://127.0.0.1:${SMOKE_PORT}/latest.json`],
    dangerousInsecureTransportProtocol: true,
    windows: { installMode: 'passive' },
  });
  const shipped = (await readJson('tauri.conf.json')).plugins.updater;
  assert.deepEqual(
    Object.keys(shipped).filter((key) => key.startsWith('dangerous')),
    [],
    '装机版的更新配置不能带 dangerous 开关',
  );
});

test('本机清单与出包脚本同形，只换下载地址', () => {
  const manifest = localManifest({ signature: 'c2ln', pubDate: '2026-10-30T00:00:00.000Z' });
  assert.equal(manifest.version, CANDIDATE_VERSION);
  assert.deepEqual(Object.keys(manifest.platforms), ['windows-x86_64-nsis']);
  assert.deepEqual(manifest.platforms['windows-x86_64-nsis'], {
    signature: 'c2ln',
    url: `http://127.0.0.1:${SMOKE_PORT}/candidate-setup.exe`,
  });
});

test('探针记录逐行解析，写到一半的行先跳过', () => {
  const text =
    '{"version":"0.0.1","event":"started","detail":null}\n' +
    '{"version":"0.0.1","event":"ready-to-restart","detail":{}}\r\n' +
    '{"version":"0.0.2","eve';
  assert.deepEqual(
    parseProbeLog(text).map(({ version, event }) => `${version} ${event}`),
    ['0.0.1 started', '0.0.1 ready-to-restart'],
  );
});
