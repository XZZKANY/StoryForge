import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  appendAssistantSessionMessage,
  createAssistantSession,
  mapAssistantSessionToHomeRecentItem,
  readAssistantSession,
  readRecentAssistantSessions,
} from '../components/home/assistant-session-store';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('mapAssistantSessionToHomeRecentItem 保留任务类型和追溯引用', () => {
  const item = mapAssistantSessionToHomeRecentItem({
    id: 7,
    title: '三章试读任务',
    task_type: 'trial_generation',
    blueprint_id: 10,
    book_run_id: 20,
    artifact_id: 30,
    messages: [],
  });

  assert.equal(item.title, '三章试读任务');
  assert.equal(item.summary, '试读生成，关联 BookRun #20 / Artifact #30 / Blueprint #10');
  assert.equal(item.href, '/?assistant_session_id=7&book_run_id=20&artifact_id=30&blueprint_id=10');
});

test('readRecentAssistantSessions 通过统一 API client 读取最近会话', async () => {
  const requestedUrls: string[] = [];
  const requestedHeaders: string[] = [];

  globalThis.fetch = async (input, init) => {
    requestedUrls.push(String(input));
    requestedHeaders.push(new Headers(init?.headers).get('X-StoryForge-API-Key') ?? '');
    return new Response(
      JSON.stringify([
        {
          id: 8,
          title: '导出审计报告',
          task_type: 'artifact_export',
          blueprint_id: null,
          book_run_id: 21,
          artifact_id: 55,
          messages: [],
        },
      ]),
      { status: 200 },
    );
  };

  const result = await readRecentAssistantSessions(5);

  assert.equal(result.status, 'ready');
  assert.deepEqual(requestedUrls, ['http://127.0.0.1:8000/api/assistant/sessions?limit=5']);
  assert.deepEqual(requestedHeaders, ['local-dev-key']);
  if (result.status === 'ready') {
    assert.deepEqual(result.data, [
      {
        title: '导出审计报告',
        summary: '产物导出，关联 BookRun #21 / Artifact #55',
        href: '/?assistant_session_id=8&book_run_id=21&artifact_id=55',
      },
    ]);
  }
});

test('readRecentAssistantSessions 对异常响应返回错误状态', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ invalid: true }), {
      status: 200,
    });

  const result = await readRecentAssistantSessions();

  assert.equal(result.status, 'error');
  if (result.status === 'error') {
    assert.equal(result.message, 'Assistant 最近会话响应格式不正确');
  }
});

test('readAssistantSession 通过 assistant_session_id 读取完整历史消息', async () => {
  const requestedUrls: string[] = [];

  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(
      JSON.stringify({
        id: 31,
        title: '继续审阅第二章',
        task_type: 'chapter_review',
        blueprint_id: 9,
        book_run_id: 12,
        artifact_id: null,
        messages: [
          {
            id: 51,
            session_id: 31,
            role: 'user',
            content: '审阅第二章',
          },
          {
            id: 52,
            session_id: 31,
            role: 'assistant',
            content: '已定位 Scene Packet #8。',
          },
        ],
      }),
      { status: 200 },
    );
  };

  const result = await readAssistantSession(31);

  assert.equal(result.status, 'ready');
  assert.deepEqual(requestedUrls, ['http://127.0.0.1:8000/api/assistant/sessions/31']);
  if (result.status === 'ready') {
    assert.equal(result.data.id, 31);
    assert.equal(result.data.messages.length, 2);
    assert.equal(result.data.messages[0].content, '审阅第二章');
    assert.equal(result.data.messages[1].role, 'assistant');
  }
});

test('createAssistantSession 写入真实任务引用和初始消息', async () => {
  const requests: { url: string; body: unknown; contentType: string | null }[] = [];

  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      contentType: new Headers(init?.headers).get('content-type'),
    });
    return new Response(
      JSON.stringify({
        id: 31,
        title: 'BookRun 已启动',
        task_type: 'trial_generation',
        blueprint_id: 9,
        book_run_id: 12,
        artifact_id: null,
        messages: [{ id: 41, session_id: 31, role: 'assistant', content: '已启动 BookRun #12。' }],
      }),
      { status: 201 },
    );
  };

  const result = await createAssistantSession({
    title: 'BookRun 已启动',
    task_type: 'trial_generation',
    blueprint_id: 9,
    book_run_id: 12,
    messages: [{ role: 'assistant', content: '已启动 BookRun #12。' }],
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(requests, [
    {
      url: 'http://127.0.0.1:8000/api/assistant/sessions',
      contentType: 'application/json',
      body: {
        title: 'BookRun 已启动',
        task_type: 'trial_generation',
        blueprint_id: 9,
        book_run_id: 12,
        messages: [{ role: 'assistant', content: '已启动 BookRun #12。' }],
      },
    },
  ]);
  if (result.status === 'ready') {
    assert.equal(result.data.id, 31);
    assert.equal(result.data.book_run_id, 12);
    assert.equal(result.data.blueprint_id, 9);
  }
});

test('appendAssistantSessionMessage 向已有会话追加可追溯消息', async () => {
  const requests: { url: string; body: unknown; contentType: string | null }[] = [];

  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      contentType: new Headers(init?.headers).get('content-type'),
    });
    return new Response(
      JSON.stringify({
        id: 42,
        session_id: 31,
        role: 'assistant',
        content: '已恢复 BookRun #12，关联 Blueprint #9。',
      }),
      { status: 201 },
    );
  };

  const result = await appendAssistantSessionMessage(31, {
    role: 'assistant',
    content: '已恢复 BookRun #12，关联 Blueprint #9。',
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(requests, [
    {
      url: 'http://127.0.0.1:8000/api/assistant/sessions/31/messages',
      contentType: 'application/json',
      body: {
        role: 'assistant',
        content: '已恢复 BookRun #12，关联 Blueprint #9。',
      },
    },
  ]);
});

test('createAssistantSession 对异常写入响应返回错误状态', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ invalid: true }), {
      status: 201,
    });

  const result = await createAssistantSession({
    title: '无效响应',
    task_type: 'trial_generation',
    messages: [{ role: 'assistant', content: '测试无效响应。' }],
  });

  assert.equal(result.status, 'error');
  if (result.status === 'error') {
    assert.equal(result.message, 'Assistant 会话创建响应格式不正确');
  }
});
