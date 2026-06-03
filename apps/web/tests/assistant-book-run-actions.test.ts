import assert from 'node:assert/strict';
import { test } from 'node:test';

import { submitAssistantBookRunCommand } from '../components/home/assistant-book-run-actions';

test('submitAssistantBookRunCommand 通过统一 API client 提交暂停命令', async () => {
  const formData = new FormData();
  formData.set('book_run_id', '12');
  formData.set('blueprint_id', '9');
  formData.set('book_run_command', 'pause');
  const revalidated: string[] = [];
  const sessionWrites: unknown[] = [];

  await assert.rejects(
    () =>
      submitAssistantBookRunCommand(formData, {
        apiFetch: async (path, init) => {
          assert.equal(path, '/api/book-runs/12/pause');
          assert.equal(init.method, 'POST');
          assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
          assert.deepEqual(JSON.parse(String(init.body)), { reason: '用户从 Assistant 暂停' });
          return new Response(JSON.stringify({ id: 12 }), { status: 200 });
        },
        revalidatePath: (path) => {
          revalidated.push(path);
        },
        writeAssistantBookRunSession: async (payload) => {
          sessionWrites.push(payload);
        },
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error && error.message === '/?book_run_id=12&book_run_command_status=ok',
  );
  assert.deepEqual(sessionWrites, [
    {
      bookRunId: 12,
      blueprintId: 9,
      command: 'pause',
      assistantSessionId: undefined,
    },
  ]);
  assert.deepEqual(revalidated, ['/']);
});

test('submitAssistantBookRunCommand 成功后向已有 AssistantSession 追加消息', async () => {
  const formData = new FormData();
  formData.set('book_run_id', '12');
  formData.set('blueprint_id', '9');
  formData.set('assistant_session_id', '31');
  formData.set('book_run_command', 'resume');
  const events: string[] = [];

  await assert.rejects(
    () =>
      submitAssistantBookRunCommand(formData, {
        apiFetch: async (path, init) => {
          events.push(`${init.method} ${path}`);
          return new Response(JSON.stringify({ id: 12 }), { status: 200 });
        },
        revalidatePath: (path) => {
          events.push(`revalidate ${path}`);
        },
        writeAssistantBookRunSession: async (payload) => {
          events.push(`session ${JSON.stringify(payload)}`);
          return payload.assistantSessionId;
        },
        redirect: (url) => {
          events.push(`redirect ${url}`);
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error &&
      error.message === '/?book_run_id=12&book_run_command_status=ok&assistant_session_id=31',
  );

  assert.deepEqual(events, [
    'POST /api/book-runs/12/resume',
    'session {"bookRunId":12,"blueprintId":9,"command":"resume","assistantSessionId":31}',
    'revalidate /',
    'redirect /?book_run_id=12&book_run_command_status=ok&assistant_session_id=31',
  ]);
});

test('submitAssistantBookRunCommand 新建会话后在 redirect 中回传 AssistantSession ID', async () => {
  const formData = new FormData();
  formData.set('book_run_id', '12');
  formData.set('book_run_command', 'retry');

  await assert.rejects(
    () =>
      submitAssistantBookRunCommand(formData, {
        apiFetch: async () => new Response(JSON.stringify({ id: 12 }), { status: 200 }),
        revalidatePath: () => {},
        writeAssistantBookRunSession: async () => 44,
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error &&
      error.message === '/?book_run_id=12&book_run_command_status=ok&assistant_session_id=44',
  );
});

test('submitAssistantBookRunCommand 对无正文命令不发送多余 payload', async () => {
  const formData = new FormData();
  formData.set('book_run_id', '12');
  formData.set('book_run_command', 'retry');

  await assert.rejects(
    () =>
      submitAssistantBookRunCommand(formData, {
        apiFetch: async (path, init) => {
          assert.equal(path, '/api/book-runs/12/retry');
          assert.equal(init.method, 'POST');
          assert.equal(init.body, undefined);
          return new Response(JSON.stringify({ id: 12 }), { status: 200 });
        },
        revalidatePath: () => {},
        writeAssistantBookRunSession: async () => {},
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error && error.message === '/?book_run_id=12&book_run_command_status=ok',
  );
});

test('submitAssistantBookRunCommand 对缺失参数返回 invalid 状态', async () => {
  const formData = new FormData();
  formData.set('book_run_command', 'pause');

  await assert.rejects(
    () =>
      submitAssistantBookRunCommand(formData, {
        apiFetch: async () => {
          throw new Error('不应调用 API');
        },
        revalidatePath: () => {},
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) => error instanceof Error && error.message === '/?book_run_command_status=invalid',
  );
});
