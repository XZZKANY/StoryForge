import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { GET } from '../app/api/book-runs/[bookRunId]/events/route';

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

test('BookRun SSE 代理在服务端注入 API Key 并转发事件流', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-key';
  const calls: Array<{ readonly url: URL; readonly init: RequestInit }> = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: url as URL, init: init ?? {} });
    return new Response('event: progress\ndata: {"book_run_id":12}\n\n', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;

  const response = await GET(new Request('https://web.storyforge.test/api/book-runs/12/events'), {
    params: Promise.resolve({ bookRunId: '12' }),
  });
  const body = await response.text();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.toString(), 'https://api.storyforge.test/api/ide/runs/12/events');
  assert.equal((calls[0].init.headers as Headers).get('X-StoryForge-API-Key'), 'unit-key');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-store, no-transform');
  assert.ok(body.includes('event: progress'));
  assert.ok(body.includes('"book_run_id":12'));
});

test('BookRun SSE 代理保留上游错误响应类型，避免把 404 伪装成事件流', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-key';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: 'BookRun 不存在' }), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  const response = await GET(new Request('https://web.storyforge.test/api/book-runs/404/events'), {
    params: Promise.resolve({ bookRunId: '404' }),
  });
  const body = await response.text();

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(body.includes('BookRun 不存在'));
});
