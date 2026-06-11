import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { POST } from '../app/api/ide/commands/[commandId]/route';

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

test('IDE 命令 Route Handler 在服务端代理 FastAPI 并注入 API Key', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-key';
  const calls: Array<{ readonly url: URL; readonly init: RequestInit }> = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: url as URL, init: init ?? {} });
    return new Response(
      JSON.stringify({
        command_id: 'judge.run',
        status: 'accepted',
        audit_event_id: 'audit:judge.run',
        payload: { ok: true },
      }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const response = await POST(
    new Request('https://web.storyforge.test/api/ide/commands/judge.run', {
      method: 'POST',
      body: JSON.stringify({ args: { scene_packet_id: 42 } }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ commandId: 'judge.run' }) },
  );
  const payload = await response.json();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.toString(), 'https://api.storyforge.test/api/ide/commands/judge.run');
  assert.equal((calls[0].init.headers as Headers).get('X-StoryForge-API-Key'), 'unit-key');
  assert.equal((calls[0].init.headers as Headers).get('content-type'), 'application/json');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, JSON.stringify({ args: { scene_packet_id: 42 } }));
  assert.equal(response.status, 202);
  assert.equal(payload.audit_event_id, 'audit:judge.run');
});

test('IDE 命令 Route Handler 透传上游错误状态与响应体', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-key';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: '命令不存在' }), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  const response = await POST(
    new Request('https://web.storyforge.test/api/ide/commands/missing.command', {
      method: 'POST',
      body: JSON.stringify({ args: {} }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ commandId: 'missing.command' }) },
  );
  const body = await response.text();

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.ok(body.includes('命令不存在'));
});
