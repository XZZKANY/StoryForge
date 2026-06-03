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
  failed: 'Assistant 连续会话浏览器验证失败',
  passed: 'Assistant 连续会话浏览器验证通过',
};

const contextParams = {
  assistant_session_id: '31',
  book_id: '12',
  target_chapter_ordinal: '2',
  artifact_id: '88',
};
const intentText = '审阅第二章';

function parseArgs(argv) {
  const args = { port: 3191, timeoutMs: 60_000, baseUrl: '' };
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

function buildSessionUrl(baseUrl) {
  const url = new URL('/', baseUrl);
  for (const [key, value] of Object.entries(contextParams)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function assertHiddenContext(page) {
  for (const [key, expected] of Object.entries(contextParams)) {
    const input = page.locator(`form[action="/"] input[type="hidden"][name="${key}"]`);
    await assertInputValue(input, expected, `hidden input ${key}`);
  }
}

async function assertInputValue(locator, expected, label) {
  await assert.doesNotReject(async () => {
    await locator.waitFor({ state: 'attached', timeout: 10_000 });
  }, `${label} 应存在`);
  assert.equal(await locator.inputValue(), expected, `${label} 应保留 ${expected}`);
}

function assertUrlContext(urlValue) {
  const url = new URL(urlValue);
  for (const [key, expected] of Object.entries(contextParams)) {
    assert.equal(url.searchParams.get(key), expected, `URL 应保留 ${key}`);
  }
}

async function verifyContinuousSession(baseUrl) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  try {
    await page.goto(buildSessionUrl(baseUrl), { waitUntil: 'domcontentloaded' });
    assertUrlContext(page.url());
    await assertHiddenContext(page);

    const composerForm = page.locator('form[action="/"]');
    await submitIntentAfterHydration(composerForm, page);

    assertUrlContext(page.url());
    assert.equal(new URL(page.url()).searchParams.get('intent'), intentText, 'URL 应保留用户输入');

    await page.reload({ waitUntil: 'domcontentloaded' });
    assertUrlContext(page.url());
    await assertHiddenContext(page);
  } finally {
    await browser.close();
  }
}

async function submitIntentAfterHydration(composerForm, page) {
  const deadline = Date.now() + 20_000;
  const textarea = composerForm.locator('textarea[name="intent"]');
  const sendButton = composerForm.locator('button[type="submit"]');
  await textarea.waitFor({ state: 'visible', timeout: 10_000 });
  await assert.doesNotReject(async () => {
    await sendButton.waitFor({ state: 'visible', timeout: 10_000 });
  }, '发送按钮应可见');

  let lastState = null;
  let lastClickError = null;
  while (Date.now() < deadline) {
    await textarea.fill('');
    await textarea.fill(intentText);
    await delay(250);
    lastState = await composerForm.evaluate((form) => {
      const field = form.querySelector('textarea[name="intent"]');
      const button = form.querySelector('button[type="submit"]');
      return {
        value: field instanceof HTMLTextAreaElement ? field.value : '',
        disabled: button instanceof HTMLButtonElement ? button.disabled : null,
        forms: document.forms.length,
      };
    });
    if (lastState.value === intentText && lastState.disabled === false) {
      try {
        await sendButton.click({ timeout: 2_000 });
        await page.waitForFunction(
          (expectedIntent) => {
            const url = new URL(window.location.href);
            return url.pathname === '/' && url.searchParams.get('intent') === expectedIntent;
          },
          intentText,
          { timeout: 3_000 },
        );
        return;
      } catch (error) {
        lastClickError = error instanceof Error ? error.message : String(error);
      }
    }
    await delay(250);
  }
  assert.fail(
    `输入框应在水合后可提交，最后状态：${JSON.stringify({ lastState, lastClickError })}`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.baseUrl) {
    await waitForReady(args.baseUrl, args.timeoutMs);
    await verifyContinuousSession(args.baseUrl);
    return;
  }
  await withStartedServer(args, verifyContinuousSession);
}

try {
  await main();
  console.log(messages.passed);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${messages.failed}: ${message}`);
  process.exitCode = 1;
}
