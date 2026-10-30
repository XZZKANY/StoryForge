import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  UPDATER_ENDPOINT,
  buildLatestJson,
  minisignKeyId,
  releaseAssetName,
  signingEnvironment,
} from './release-build.mjs';

const tauriDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri');
const readJson = async (name) => JSON.parse(await readFile(resolve(tauriDir, name), 'utf8'));

/** 照 minisign 的格式拼一段 tauri 存法（整段文本再 base64）的公钥 / 签名。 */
function minisign(algorithm, keyId, bodyLength) {
  const payload = Buffer.concat([
    Buffer.from(algorithm),
    Buffer.from(keyId, 'hex'),
    Buffer.alloc(bodyLength, 7),
  ]).toString('base64');
  return Buffer.from(`untrusted comment: test\n${payload}\ntrusted comment: t\nAAAA\n`).toString(
    'base64',
  );
}

test('latest.json 只给 NSIS 一项，下载地址指向同名 Release 资产', () => {
  const manifest = buildLatestJson({
    version: '0.2.4',
    notes: '  修了两处断流\n',
    signature: 'c2ln\n',
    pubDate: '2026-11-01T00:00:00.000Z',
  });
  assert.deepEqual(manifest, {
    version: '0.2.4',
    notes: '修了两处断流',
    pub_date: '2026-11-01T00:00:00.000Z',
    platforms: {
      'windows-x86_64-nsis': {
        signature: 'c2ln',
        url: 'https://github.com/XZZKANY/StoryForge/releases/download/v0.2.4/StoryForge-IDE_0.2.4_x64-setup.exe',
      },
    },
  });
  assert.equal(releaseAssetName('0.2.4'), 'StoryForge-IDE_0.2.4_x64-setup.exe');
});

test('版本号、更新说明、签名缺一不可', () => {
  const ok = { version: '0.2.4', notes: 'n', signature: 's', pubDate: 'd' };
  assert.throws(() => buildLatestJson({ ...ok, version: 'v0.2.4' }), /X\.Y\.Z/);
  assert.throws(() => buildLatestJson({ ...ok, notes: ' \n' }), /更新说明/);
  assert.throws(() => buildLatestJson({ ...ok, signature: '' }), /签名/);
});

test('签名的密钥 id 与公钥对得上才算同一把钥匙', () => {
  const pub = minisign('Ed', '0011223344556677', 32);
  assert.equal(minisignKeyId(pub), '0011223344556677');
  assert.equal(minisignKeyId(minisign('ED', '0011223344556677', 64)), minisignKeyId(pub));
  assert.notEqual(minisignKeyId(minisign('ED', 'ffeeddccbbaa9988', 64)), minisignKeyId(pub));
  assert.throws(() => minisignKeyId(Buffer.from('junk').toString('base64')), /minisign/);
});

test('私钥默认在 ~/.storyforge-updater，密码必须由作者在终端给', () => {
  const home = resolve('/home/author');
  const defaultKey = resolve(home, '.storyforge-updater', 'storyforge-updater.key');
  const found = (path) => path === defaultKey;
  assert.equal(
    signingEnvironment({ TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' }, home, found)
      .TAURI_SIGNING_PRIVATE_KEY,
    defaultKey,
  );
  assert.equal(
    signingEnvironment(
      { TAURI_SIGNING_PRIVATE_KEY: 'D:/keys/k.key', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'p' },
      home,
      () => false,
    ).TAURI_SIGNING_PRIVATE_KEY,
    'D:/keys/k.key',
  );
  assert.throws(() => signingEnvironment({}, home, found), /私钥密码/);
  assert.throws(
    () => signingEnvironment({ TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' }, home, () => false),
    /找不到更新签名私钥/,
  );
});

test('装机版读的更新地址与公钥就是出包脚本用的那一套', async () => {
  const config = await readJson('tauri.conf.json');
  const updater = config.plugins.updater;
  assert.deepEqual(updater.endpoints, [UPDATER_ENDPOINT]);
  assert.match(Buffer.from(updater.pubkey, 'base64').toString('utf8'), /minisign public key/);
  assert.equal(minisignKeyId(updater.pubkey).length, 16);
  assert.equal(config.bundle.createUpdaterArtifacts, undefined);
  const release = await readJson('tauri.release.conf.json');
  assert.equal(release.bundle.createUpdaterArtifacts, true);
});

test('宿主注册了更新插件与三个命令，界面问的就是这些命令', async () => {
  const main = await readFile(resolve(tauriDir, 'src', 'main.rs'), 'utf8');
  assert.match(main, /\.plugin\(tauri_plugin_updater::Builder::new\(\)\.build\(\)\)/);
  assert.match(main, /\.manage\(app_update::StagedUpdate::default\(\)\)/);
  const lib = resolve(tauriDir, '..', 'frontend', 'src', 'lib');
  const frontend =
    (await readFile(resolve(lib, 'update-check.ts'), 'utf8')) +
    (await readFile(resolve(lib, 'app-update.ts'), 'utf8'));
  for (const command of ['app_update_check', 'app_update_download', 'app_update_restart_install']) {
    assert.match(main, new RegExp(`app_update::${command},`));
    assert.match(frontend, new RegExp(`'${command}'`));
  }
});

test('装更新挂在退出握手最后一步；未保存那一步选了不关就撤销', async () => {
  const hostClose = await readFile(resolve(tauriDir, 'src', 'host_close.rs'), 'utf8');
  assert.match(
    hostClose,
    /state\.finish\(\);\s+crate::app_update::install_if_armed\(&app\);\s+app\.exit\(exit_code\);/,
  );
  const closeGuard = await readFile(resolve(tauriDir, 'src', 'close_guard.rs'), 'utf8');
  assert.match(
    closeGuard,
    /if guard\.resolve\(request, proceed\) \{\s+app\.exit\(0\);\s+\} else if !proceed \{\s+crate::app_update::disarm\(&app\);/,
  );
});
