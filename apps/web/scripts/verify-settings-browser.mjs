#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const messages = {
  unknownArg: '未知参数',
  exitedEarly: 'Next dev 服务提前退出',
  ready: 'Next 服务已就绪',
  returned: '返回',
  timeout: '等待 Next 服务就绪超时',
  start: '启动 Next dev',
  failed: 'settings 页浏览器交互验证失败',
  passed: 'settings 页浏览器交互验证通过',
};

const providerStorageKey = 'storyforge-provider-settings';
const creativeStorageKey = 'storyforge-creative-preferences';
const providerBaseUrl = 'https://provider.example.test';
const providerApiKey = 'sk-storyforge-browser-test';

function parseArgs(argv) {
  const args = { port: 3192, timeoutMs: 60_000, baseUrl: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--port' && value) {
      args.port = Number(value);
      index += 1;
      continue;
    }
    if (name === '--timeout-ms' && value) {
      args.timeoutMs = Number(value);
      index += 1;
      continue;
    }
    if (name === '--base-url' && value) {
      args.baseUrl = value.replace(/\/$/, '');
      index += 1;
      continue;
    }
    throw new Error(`${messages.unknownArg}: ${name}`);
  }
  return args;
}

function stopProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // 进程可能已经退出。
    }
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // 进程可能已经退出。
  }
}

async function waitForReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: 'manual' });
      if (response.status < 500) {
        console.log(`${messages.ready}: ${baseUrl} ${messages.returned} ${response.status}`);
        return;
      }
      lastError = new Error(`${messages.returned} ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${messages.timeout}: ${message}`);
}

async function withStartedServer({ port, timeoutMs }, task) {
  const command =
    process.platform === 'win32' ? `pnpm exec next dev --hostname 127.0.0.1 --port ${port}` : 'pnpm';
  const args =
    process.platform === 'win32'
      ? []
      : ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  console.log(`${messages.start}: ${command} ${args.join(' ')}`.trim());
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    const earlyExit = once(child, 'exit').then(([code]) => {
      throw new Error(`${messages.exitedEarly}, 实际 ${code}`);
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    await Promise.race([waitForReady(baseUrl, timeoutMs), earlyExit]);
    await task(baseUrl);
  } finally {
    stopProcessTree(child.pid);
    await Promise.race([once(child, 'exit'), delay(5_000)]).catch(() => undefined);
    stopProcessTree(child.pid);
  }
}

function assertOnlyKeys(value, expectedKeys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort(), `${label} 字段集合应严格匹配`);
}

async function readJsonStorage(page, key) {
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  assert.ok(raw, `${key} 应写入 localStorage`);
  return JSON.parse(raw);
}

async function verifyProviderSettings(page) {
  const baseUrlInput = page.getByLabel('Provider Base URL');
  const apiKeyInput = page.getByLabel('Provider API Key');
  await baseUrlInput.waitFor({ state: 'visible', timeout: 10_000 });
  await apiKeyInput.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);

  const saveButton = page
    .locator('section[aria-labelledby="provider-form-title"] button[type="button"]')
    .first();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await baseUrlInput.fill(`  ${providerBaseUrl}  `);
    await apiKeyInput.fill(`  ${providerApiKey}  `);
    await saveButton.click();
    const saved = await page.evaluate(
      ({ key, expectedBaseUrl, expectedApiKey }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        try {
          const value = JSON.parse(raw);
          return value.baseUrl === expectedBaseUrl && value.apiKey === expectedApiKey;
        } catch {
          return false;
        }
      },
      { key: providerStorageKey, expectedBaseUrl: providerBaseUrl, expectedApiKey: providerApiKey },
    );
    if (saved) break;
    await delay(250);
  }

  const stored = await readJsonStorage(page, providerStorageKey);
  assertOnlyKeys(stored, ['apiKey', 'baseUrl', 'model'], providerStorageKey);
  assert.equal(stored.baseUrl, providerBaseUrl, 'Provider Base URL 应 trim 后保存');
  assert.equal(stored.apiKey, providerApiKey, 'Provider API Key 应 trim 后保存');
}

async function verifyProviderProbe(page) {
  const capturedBodies = [];
  await page.route('**/api/provider-models', async (route) => {
    const request = route.request();
    assert.equal(request.method(), 'POST', '模型检测应使用 POST');
    capturedBodies.push(request.postDataJSON());
    await route.fulfill({
      json: {
        ok: true,
        endpoint: `${providerBaseUrl}/v1/models`,
        models: ['storyforge-browser-alpha', 'storyforge-browser-beta'],
      },
    });
  });

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await page.getByLabel('Provider Base URL').fill(`  ${providerBaseUrl}  `);
  await page.getByLabel('Provider API Key').fill(`  ${providerApiKey}  `);
  await page.getByText('Provider 可连接，发现 2 个模型。').waitFor({ timeout: 10_000 });
  const resultSection = page.locator('section[aria-labelledby="provider-result-title"]');
  await resultSection.getByRole('heading', { name: '可用模型' }).waitFor({ timeout: 10_000 });
  await resultSection.getByText('storyforge-browser-alpha').waitFor({ timeout: 10_000 });
  await resultSection.getByText('storyforge-browser-beta').waitFor({ timeout: 10_000 });
  await page.locator('#provider-model').selectOption('storyforge-browser-beta');

  const capturedBody = capturedBodies.at(-1);
  assert.ok(capturedBody, '应捕获模型检测请求体');
  assertOnlyKeys(capturedBody, ['apiKey', 'baseUrl', 'model'], '/api/provider-models 请求体');
  assert.equal(capturedBody.baseUrl, providerBaseUrl, '模型检测应发送当前 Base URL');
  assert.equal(capturedBody.apiKey, providerApiKey, '模型检测应发送当前 API Key');

  const stored = await readJsonStorage(page, providerStorageKey);
  assert.equal(stored.model, 'storyforge-browser-beta', '选择模型后应保存当前模型');
}

async function verifyCreativePreferences(page) {
  await page.getByLabel('默认题材').fill('悬疑，科幻');
  await page.getByLabel('默认文风').fill('冷峻克制');
  await page.getByLabel('Assistant 行为').fill('先确认事实源，再推进章节。');
  await page.getByRole('checkbox', { name: 'Repair.suggest' }).uncheck();
  await page.getByRole('button', { name: '保存创作偏好' }).click();
  await page.waitForFunction(
    (key) => Boolean(window.localStorage.getItem(key)),
    creativeStorageKey,
    { timeout: 10_000 },
  );

  const providerSettings = await readJsonStorage(page, providerStorageKey);
  const creativePreferences = await readJsonStorage(page, creativeStorageKey);
  assertOnlyKeys(providerSettings, ['apiKey', 'baseUrl', 'model'], providerStorageKey);
  assertOnlyKeys(
    creativePreferences,
    ['genres', 'style', 'assistantBehavior', 'defaultFlow'],
    creativeStorageKey,
  );
  assert.deepEqual(creativePreferences.genres, ['悬疑', '科幻'], '默认题材应按中文逗号拆分');
  assert.equal(creativePreferences.style, '冷峻克制', '默认文风应保存');
  assert.equal(
    creativePreferences.assistantBehavior,
    '先确认事实源，再推进章节。',
    'Assistant 行为应保存',
  );
  assert.ok(
    !creativePreferences.defaultFlow.includes('Repair.suggest'),
    '取消勾选的默认流程不应保存',
  );
  assert.ok(!('baseUrl' in creativePreferences), '创作偏好不得混入 Provider Base URL');
  assert.ok(!('genres' in providerSettings), 'Provider 设置不得混入创作偏好');
}

async function verifySettingsPage(baseUrl) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  const requestFailures = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    requestFailures.push(`${request.method()} ${request.url()}`);
  });

  try {
    await page.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '模型与 Provider 设置' }).waitFor({ timeout: 10_000 });
    await assert.doesNotReject(async () => {
      await page.getByLabel('Provider Base URL').waitFor({ state: 'visible', timeout: 10_000 });
    }, 'Provider Base URL 输入框应可见');

    await verifyProviderProbe(page);
    await verifyProviderSettings(page);
    await verifyCreativePreferences(page);

    assert.deepEqual(pageErrors, [], '页面不应产生运行时错误');
    assert.deepEqual(requestFailures, [], '页面不应产生失败请求');
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.baseUrl) {
    await waitForReady(args.baseUrl, args.timeoutMs);
    await verifySettingsPage(args.baseUrl);
    return;
  }
  await withStartedServer(args, verifySettingsPage);
}

try {
  await main();
  console.log(messages.passed);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${messages.failed}: ${message}`);
  process.exitCode = 1;
}
