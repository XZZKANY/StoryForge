#!/usr/bin/env node
/**
 * 出正式安装包（作者本机）：带更新签名构建 NSIS，另存到 output/release-<版本>/，并生成自动更新读的
 * latest.json。发布仍由作者亲手 gh release create（docs/operations/release-checklist.md）。
 *
 * 私钥默认读 ~/.storyforge-updater/storyforge-updater.key（TAURI_SIGNING_PRIVATE_KEY 可指别处）；
 * 密码由作者在当前终端设 TAURI_SIGNING_PRIVATE_KEY_PASSWORD，脚本只转交给 tauri，不读不存。
 *
 * 用法：node apps/desktop/scripts/release-build.mjs --notes <更新说明.md>
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runProcess } from './verify-nsis-install.mjs';

export const RELEASE_REPO = 'XZZKANY/StoryForge';
export const UPDATER_ENDPOINT = `https://github.com/${RELEASE_REPO}/releases/latest/download/latest.json`;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const tauriDir = resolve(desktopDir, 'src-tauri');
const repoRoot = resolve(desktopDir, '..', '..');
const tauriCli = resolve(desktopDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

/** 上传到 GitHub Release 的文件名（文件名里不带空格，链接里不用转义）。 */
export function releaseAssetName(version) {
  return `StoryForge-IDE_${version}_x64-setup.exe`;
}

/**
 * 插件按 `windows-x86_64-nsis` → `windows-x86_64` 的顺序找；只写 nsis 一项，
 * 免得哪天有人装了 msi 却被喂 NSIS 安装包。
 */
export function buildLatestJson({ version, notes, signature, pubDate }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`版本号不是 X.Y.Z：${version}`);
  if (!notes.trim()) throw new Error('更新说明是空的：作者在更新提示里会看到它');
  if (!signature.trim()) throw new Error('签名是空的');
  return {
    version,
    notes: notes.trim(),
    pub_date: pubDate,
    platforms: {
      'windows-x86_64-nsis': {
        signature: signature.trim(),
        url: `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${releaseAssetName(version)}`,
      },
    },
  };
}

/** minisign 公钥 / 签名（tauri 存成 base64 的整段文本）第二行解码后，第 2–10 字节是密钥 id。 */
export function minisignKeyId(base64Text) {
  const lines = Buffer.from(base64Text.trim(), 'base64').toString('utf8').split('\n');
  const payload = Buffer.from((lines[1] ?? '').trim(), 'base64');
  if (payload.length < 10) throw new Error('不是 minisign 公钥或签名');
  return payload.subarray(2, 10).toString('hex');
}

/** 私钥位置与密码由环境给；缺了就停下说清楚，不让 tauri 半路报错。 */
export function signingEnvironment(environment, home, exists = existsSync) {
  const defaultKey = resolve(home, '.storyforge-updater', 'storyforge-updater.key');
  const key = environment.TAURI_SIGNING_PRIVATE_KEY || (exists(defaultKey) ? defaultKey : null);
  if (!key)
    throw new Error(`找不到更新签名私钥：设 TAURI_SIGNING_PRIVATE_KEY，或放在 ${defaultKey}`);
  if (environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined)
    throw new Error(
      '先在当前终端设私钥密码：$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<生成密钥时设的密码>"',
    );
  return { ...environment, TAURI_SIGNING_PRIVATE_KEY: key };
}

function notesPathFrom(argv) {
  const index = argv.indexOf('--notes');
  if (index < 0 || !argv[index + 1])
    throw new Error('用法：node apps/desktop/scripts/release-build.mjs --notes <更新说明.md>');
  return resolve(argv[index + 1]);
}

async function main() {
  const notesPath = notesPathFrom(process.argv.slice(2));
  const notes = await readFile(notesPath, 'utf8');
  const config = JSON.parse(await readFile(resolve(tauriDir, 'tauri.conf.json'), 'utf8'));
  const version = config.version;
  const cargo = await readFile(resolve(tauriDir, 'Cargo.toml'), 'utf8');
  if (!new RegExp(`^version = "${version.replaceAll('.', '\\.')}"$`, 'm').test(cargo))
    throw new Error(`tauri.conf.json 是 ${version}，Cargo.toml 的版本号没跟着改`);
  const outDir = resolve(repoRoot, 'output', `release-${version}`);
  const asset = resolve(outDir, releaseAssetName(version));
  if (existsSync(asset))
    throw new Error(`${asset} 已存在：出过的版本号不能复用，确认没发布过再手动删掉它`);
  const env = signingEnvironment(process.env, homedir());

  await runProcess(process.execPath, [resolve(scriptDir, 'prepare-bundled-git.mjs')], {
    cwd: desktopDir,
  });
  await runProcess(
    process.execPath,
    [
      tauriCli,
      'build',
      '--bundles',
      'nsis',
      '--config',
      resolve(tauriDir, 'tauri.release.conf.json'),
    ],
    { cwd: desktopDir, env },
  );

  const targetDir = process.env.CARGO_TARGET_DIR || resolve(tauriDir, 'target');
  const installer = resolve(
    targetDir,
    'release',
    'bundle',
    'nsis',
    `${config.productName}_${version}_x64-setup.exe`,
  );
  const signature = await readFile(`${installer}.sig`, 'utf8');
  const expectedKey = minisignKeyId(config.plugins.updater.pubkey);
  if (minisignKeyId(signature) !== expectedKey)
    throw new Error('安装包签名用的私钥与 tauri.conf.json 里的公钥对不上：装机版会拒收这个更新');

  await mkdir(outDir, { recursive: true });
  await copyFile(installer, asset);
  const manifest = buildLatestJson({
    version,
    notes,
    signature,
    pubDate: new Date().toISOString(),
  });
  await writeFile(resolve(outDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const bytes = await readFile(asset);
  console.log(`安装包：${asset}`);
  console.log(
    `大小：${bytes.length} 字节  SHA256：${createHash('sha256').update(bytes).digest('hex')}`,
  );
  console.log(`latest.json：${resolve(outDir, 'latest.json')}`);
  console.log('发布（作者亲手跑）：');
  console.log(
    `gh release create v${version} "${asset}" "${resolve(outDir, 'latest.json')}" --repo ${RELEASE_REPO} --title "StoryForge ${version}" --notes-file "${notesPath}"`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
