#!/usr/bin/env node
/**
 * 自动更新升级冒烟：与 verify-nsis-install 同一个隔离测试身份，一次性签名密钥，本机 http 清单。
 * 先装旧版 → 应用里照作者的点法「设置 → 关于 → 检查更新 → 下载新版 → 重启安装」（宿主 update_smoke 驱动）
 * → 安装器被动装好并重新打开新版 → 新版再查是「已是最新」；核对装上的是新版、作品与引擎库还在。
 * 不碰作者的装机版、数据与私钥。跑之前要关掉 StoryForge：NSIS 安装器按进程名结束同名进程。
 *
 * 用法：node apps/desktop/scripts/verify-update-smoke.mjs
 */
import assert from 'node:assert/strict';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildLatestJson } from './release-build.mjs';
import {
  TEST_IDENTIFIER,
  TEST_PRODUCT_NAME,
  aggregateFailures,
  assertCleanTestIdentity,
  assertInstallerProcessSafety,
  cleanupOwnedTestIdentity,
  createVerificationLayout,
  exists,
  fileDigest,
  nsisExecutableDigest,
  registryValue,
  runProcess,
  snapshotProduction,
  terminateOwnedInstallProcesses,
  treeDigest,
  verifyInstalledResources,
  waitFor,
  windowsKnownDesktopPath,
} from './verify-nsis-install.mjs';

export const BASELINE_VERSION = '0.0.1';
export const CANDIDATE_VERSION = '0.0.2';
export const SMOKE_PORT = 47391;
const LOG_ARG = '--storyforge-update-smoke-log=';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const tauriDir = resolve(desktopDir, 'src-tauri');
const repoRoot = resolve(desktopDir, '..', '..');
// 新 worktree 里没有编译缓存，可指到主仓库的同名目录复用。
const targetDir = process.env.STORYFORGE_UPDATE_SMOKE_TARGET_DIR
  ? resolve(process.env.STORYFORGE_UPDATE_SMOKE_TARGET_DIR)
  : resolve(desktopDir, '.tauri-target-install-smoke');
const tauriCli = resolve(desktopDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

/** 在隔离安装冒烟的身份上叠版本号、签名产物与本机清单地址（只用于测试身份，不进装机版）。 */
export function updateSmokeOverlay(installSmoke, { version, pubkey }) {
  return {
    ...installSmoke,
    version,
    bundle: { ...installSmoke.bundle, createUpdaterArtifacts: true },
    plugins: {
      updater: {
        pubkey,
        endpoints: [`http://127.0.0.1:${SMOKE_PORT}/latest.json`],
        dangerousInsecureTransportProtocol: true,
        windows: { installMode: 'passive' },
      },
    },
  };
}

/** 清单用出包脚本同一个构建函数，只把下载地址换成本机。 */
export function localManifest({ signature, pubDate }) {
  const manifest = buildLatestJson({
    version: CANDIDATE_VERSION,
    notes: '升级冒烟：本机清单',
    signature,
    pubDate,
  });
  manifest.platforms['windows-x86_64-nsis'].url =
    `http://127.0.0.1:${SMOKE_PORT}/candidate-setup.exe`;
  return manifest;
}

/** 宿主 update_smoke 每步追加一行 JSON；解析不了的行（写到一半）先跳过。 */
export function parseProbeLog(text) {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

async function buildVersion(work, installSmoke, version, pubkey, env) {
  const overlay = resolve(work, `overlay-${version}.json`);
  await writeFile(overlay, JSON.stringify(updateSmokeOverlay(installSmoke, { version, pubkey })));
  await runProcess(
    process.execPath,
    [tauriCli, 'build', '--ci', '--bundles', 'nsis', '--config', overlay],
    { cwd: desktopDir, env },
  );
  const built = resolve(
    targetDir,
    'release',
    'bundle',
    'nsis',
    `${TEST_PRODUCT_NAME}_${version}_x64-setup.exe`,
  );
  const installer = resolve(work, `${version}-setup.exe`);
  await copyFile(built, installer);
  const signature = await readFile(`${built}.sig`, 'utf8');
  const payloadDigest = nsisExecutableDigest(
    await readFile(resolve(targetDir, 'release', 'storyforge-desktop.exe')),
  );
  // verify-nsis-install 要求包目录里只有一个测试安装包：拷走后删掉这两个版本的产物。
  await rm(built, { force: true });
  await rm(`${built}.sig`, { force: true });
  return { installer, signature, payloadDigest };
}

function serve(files) {
  const requests = [];
  const server = createServer((request, response) => {
    const file = files[request.url ?? ''];
    requests.push({ path: request.url, found: Boolean(file) });
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': file.type });
    if (file.body !== undefined) response.end(file.body);
    else createReadStream(file.path).pipe(response);
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', (error) =>
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`端口 ${SMOKE_PORT} 被占用：测试清单地址是构建时写死的，先关掉占用它的程序`)
          : error,
      ),
    );
    server.listen(SMOKE_PORT, '127.0.0.1', () => resolvePromise({ server, requests }));
  });
}

async function waitForEvent(logPath, version, event, timeoutMs) {
  let events = [];
  await waitFor(
    async () => {
      events = existsSync(logPath) ? parseProbeLog(await readFile(logPath, 'utf8')) : [];
      const failed = events.find((entry) => entry.event === 'failed');
      if (failed)
        throw new Error(`应用 ${failed.version} 的更新流程失败：${JSON.stringify(failed.detail)}`);
      return events.some((entry) => entry.version === version && entry.event === event);
    },
    `${version} ${event}`,
    timeoutMs,
  );
  return events;
}

export async function verifyUpdateSmoke() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error(`升级冒烟只在 win32/x64 上跑，当前 ${process.platform}/${process.arch}`);
  const layout = createVerificationLayout(process.env, await windowsKnownDesktopPath());
  const productionBefore = await snapshotProduction(layout);
  await assertCleanTestIdentity(layout);
  await assertInstallerProcessSafety(layout);

  const work = resolve(
    repoRoot,
    'output',
    'update-smoke',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await mkdir(work, { recursive: true });
  const installSmoke = JSON.parse(
    await readFile(resolve(tauriDir, 'tauri.install-smoke.conf.json'), 'utf8'),
  );
  assert.equal(installSmoke.identifier, TEST_IDENTIFIER);
  const keyPath = resolve(work, 'smoke-updater.key');
  // 一次性密钥只给这次冒烟签名，和作者的私钥无关。
  await runProcess(
    process.execPath,
    [tauriCli, 'signer', 'generate', '--ci', '-p', '', '-w', keyPath],
    {
      cwd: desktopDir,
      capture: true,
    },
  );
  const pubkey = (await readFile(`${keyPath}.pub`, 'utf8')).trim();
  const env = {
    ...process.env,
    CARGO_TARGET_DIR: targetDir,
    TAURI_SIGNING_PRIVATE_KEY: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
  };
  await runProcess(process.execPath, [resolve(scriptDir, 'prepare-bundled-git.mjs')], {
    cwd: desktopDir,
  });
  const baseline = await buildVersion(work, installSmoke, BASELINE_VERSION, pubkey, env);
  const candidate = await buildVersion(work, installSmoke, CANDIDATE_VERSION, pubkey, env);
  const manifest = localManifest({
    signature: candidate.signature,
    pubDate: new Date().toISOString(),
  });
  await writeFile(resolve(work, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const { server, requests } = await serve({
    '/latest.json': { type: 'application/json', body: JSON.stringify(manifest) },
    '/candidate-setup.exe': { type: 'application/octet-stream', path: candidate.installer },
  });
  const logPath = resolve(work, 'probe.jsonl');
  const failures = [];
  let ownsTestIdentity = false;
  let evidence;
  try {
    ownsTestIdentity = true;
    await assertInstallerProcessSafety(layout);
    await runProcess(baseline.installer, ['/S']);
    await waitFor(() => exists(resolve(layout.installDir, 'uninstall.exe')), 'baseline install');
    const installed = await verifyInstalledResources(layout);
    assert.match(
      (await registryValue(layout.testRegistryKey)) ?? '',
      new RegExp(`DisplayVersion\\s+REG_SZ\\s+${BASELINE_VERSION.replaceAll('.', '\\.')}`),
    );
    // 自己写的测试原稿，不复制作者的任何数据。
    const project = resolve(layout.appLocalDataDir, 'update-smoke-project');
    await mkdir(project, { recursive: true });
    await writeFile(
      resolve(project, 'chapter.md'),
      '# 自动更新保留验收\r\n\r\n作者自己的原稿，不得被更新改动。\r\n',
      { flag: 'wx' },
    );
    const projectDigest = await treeDigest(project);

    // 记录文件走命令行：安装器重新打开新版时不继承环境，但插件会把这条命令行转给它。
    assert.doesNotMatch(logPath, /\s/, '记录文件路径不能带空格（转给安装器时要原样传）');
    const child = spawn(installed.executable, [`${LOG_ARG}${logPath}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    await waitForEvent(logPath, BASELINE_VERSION, 'ready-to-restart', 5 * 60_000);
    // 停在作品库页时引擎库不一定建出来：建了就要求更新后还在，没建就照实记下。
    const engineDb = resolve(layout.appLocalDataDir, 'storyforge-engine.sqlite3');
    const engineDbBefore = await exists(engineDb);
    const events = await waitForEvent(logPath, CANDIDATE_VERSION, 'up-to-date', 5 * 60_000);

    assert.equal(
      await fileDigest(installed.executable),
      candidate.payloadDigest,
      '装上的不是新版安装包里的程序',
    );
    assert.match(
      (await registryValue(layout.testRegistryKey)) ?? '',
      new RegExp(`DisplayVersion\\s+REG_SZ\\s+${CANDIDATE_VERSION.replaceAll('.', '\\.')}`),
    );
    assert.equal(await treeDigest(project), projectDigest, '更新改动了作者的原稿');
    if (engineDbBefore) assert.ok((await stat(engineDb)).size > 0, '更新后引擎库不见了');
    const paths = requests.map((entry) => entry.path);
    assert.equal(
      paths.filter((path) => path === '/candidate-setup.exe').length,
      1,
      '新版安装包应只下载一次',
    );
    assert.ok(
      paths.filter((path) => path === '/latest.json').length >= 3,
      '旧版检查、下载前复查、新版检查都应读清单',
    );
    assert.ok(
      requests.every((entry) => entry.found),
      `有请求落空：${JSON.stringify(requests)}`,
    );
    evidence = {
      baselineVersion: BASELINE_VERSION,
      candidateVersion: CANDIDATE_VERSION,
      events: events.map(({ version, event }) => `${version} ${event}`),
      requests: paths,
      installedExecutableMatchesCandidate: true,
      manuscriptPreserved: true,
      engineDatabasePreserved: engineDbBefore ? true : 'baseline-did-not-create-it',
      work,
    };
  } catch (error) {
    failures.push(error);
  } finally {
    await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    if (ownsTestIdentity) {
      try {
        await terminateOwnedInstallProcesses(layout);
        await cleanupOwnedTestIdentity(layout);
      } catch (error) {
        failures.push(error);
      }
    }
  }
  try {
    assert.deepEqual(await snapshotProduction(layout), productionBefore, '作者的装机版被改动了');
  } catch (error) {
    failures.push(error);
  }
  const failure = aggregateFailures(failures, '升级冒烟、清理或装机版守卫失败');
  if (failure) throw failure;
  await writeFile(resolve(work, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`自动更新升级冒烟通过\n${JSON.stringify(evidence, null, 2)}`);
  return evidence;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await verifyUpdateSmoke();
