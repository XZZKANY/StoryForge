import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { apiFetch, getApiBaseUrl, readJson } from '../lib/api-client';

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.STORYFORGE_API_BASE_URL;
const originalApiKey = process.env.STORYFORGE_API_KEY;

function restoreEnvValue(
  key: 'STORYFORGE_API_BASE_URL' | 'STORYFORGE_API_KEY',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnvValue('STORYFORGE_API_BASE_URL', originalBaseUrl);
  restoreEnvValue('STORYFORGE_API_KEY', originalApiKey);
});

test('getApiBaseUrl 优先使用环境变量覆盖值', () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';

  assert.equal(getApiBaseUrl(), 'https://api.storyforge.test');
});

test('api-client 声明 server-only 且不保留 Web 侧默认 API Key', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'api-client.ts'), 'utf8');

  assert.ok(source.includes("import 'server-only'"));
  assert.ok(!source.includes('local-dev-key'), 'Web 服务端 API client 不应保留硬编码默认 API Key');
});

test('apiFetch 注入 X-StoryForge-API-Key 并保留调用参数', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-test-key';
  const calls: Array<{ readonly url: URL; readonly init: RequestInit }> = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: url as URL, init: init ?? {} });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  await apiFetch('/api/books', {
    method: 'POST',
    params: { book_id: 42, empty: '', skipped: undefined },
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '测试作品' }),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.toString(), 'https://api.storyforge.test/api/books?book_id=42');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.cache, 'no-store');
  const headers = calls[0].init.headers as Headers;
  assert.equal(headers.get('X-StoryForge-API-Key'), 'unit-test-key');
  assert.equal(headers.get('content-type'), 'application/json');
});

test('apiFetch 缺少 STORYFORGE_API_KEY 时抛出中文配置错误且不发起请求', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  delete process.env.STORYFORGE_API_KEY;
  globalThis.fetch = (async () => {
    throw new Error('缺少 API Key 时不应发起上游请求');
  }) as typeof fetch;

  await assert.rejects(
    () => apiFetch('/api/books'),
    /缺少 STORYFORGE_API_KEY，无法调用 StoryForge API。/,
  );
});

test('readJson 将非成功响应转换为错误状态', async () => {
  process.env.STORYFORGE_API_KEY = 'unit-test-key';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: '失败' }), { status: 503 })) as typeof fetch;

  const result = await readJson('/api/books', {
    validate: (value): value is { readonly ok: boolean } =>
      typeof value === 'object' && value !== null,
    invalidMessage: '响应格式错误',
  });

  assert.deepEqual(result, { status: 'error', message: 'API 返回 503' });
});
