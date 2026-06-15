import assert from 'node:assert/strict';
import { test } from 'node:test';

import { submitAssistantArtifactExport } from '../components/home/assistant-artifact-export-actions';

test('submitAssistantArtifactExport 对 completed BookRun 依次导出 Markdown、EPUB 和审计报告', async () => {
  const formData = new FormData();
  formData.set('book_run_id', '12');
  const calls: string[] = [];
  const sessionWrites: unknown[] = [];
  const toolCallWrites: unknown[] = [];

  await assert.rejects(
    () =>
      submitAssistantArtifactExport(formData, {
        readBookRun: async (bookRunId) => {
          assert.equal(bookRunId, 12);
          return {
            id: 12,
            workspace_id: 3,
            book_id: 5,
            blueprint_id: 9,
            status: 'completed',
            current_chapter_index: 3,
            total_chapters: 3,
            progress: {},
            checkpoint: [],
            token_budget: null,
            tokens_used: 100,
            time_budget_sec: null,
            elapsed_time_sec: 20,
            total_latency_ms: 0,
            max_latency_ms: 0,
            avg_latency_ms: 0,
            chapter_budget: 3,
            estimated_cost: 0.1,
            cost_summary: {},
          };
        },
        apiFetch: async (path, init) => {
          calls.push(`${init.method ?? 'GET'} ${path}`);
          const names = ['book.md', 'book.epub', 'audit_report.json'];
          return new Response(
            JSON.stringify({
              id: calls.length,
              name: names[calls.length - 1],
              version: calls.length + 1,
              mime_type: calls.length === 1 ? 'text/markdown' : 'application/json',
              payload: { book_run_id: 12 },
            }),
            {
              status: 200,
            },
          );
        },
        revalidatePath: () => {},
        writeAssistantArtifactExportSession: async (payload) => {
          sessionWrites.push(payload);
        },
        writeAssistantToolCall: async (payload) => {
          toolCallWrites.push(payload);
        },
        redirect: (url) => {
          const redirected = new URL(url, 'http://storyforge.local');
          assert.equal(redirected.searchParams.get('book_run_id'), '12');
          assert.equal(redirected.searchParams.get('artifact_export_status'), 'ok');
          const summary = redirected.searchParams.get('artifact_export_summary') ?? '';
          assert.ok(summary.includes('book.md'), '导出成功后应回传 Markdown 制品摘要');
          assert.ok(summary.includes('book.epub'), '导出成功后应回传 EPUB 制品摘要');
          assert.ok(summary.includes('audit_report.json'), '导出成功后应回传审计报告制品摘要');
          assert.ok(summary.includes('v2'), '导出成功摘要应包含制品版本');
          assert.ok(summary.includes('BookRun #12'), '导出成功摘要应包含关联 BookRun');
          assert.ok(summary.includes('Artifacts 下载摘要'), '导出成功摘要应提示下载摘要查看位置');
          throw new Error('redirect-ok');
        },
      }),
    (error) => error instanceof Error && error.message === 'redirect-ok',
  );

  assert.deepEqual(calls, [
    'POST /api/book-runs/12/exports/markdown?workspace_id=3',
    'POST /api/book-runs/12/exports/epub?workspace_id=3',
    'POST /api/book-runs/12/exports/audit-report?workspace_id=3',
  ]);
  assert.deepEqual(sessionWrites, [
    {
      bookRunId: 12,
      assistantSessionId: undefined,
      artifacts: [
        { id: 1, name: 'book.md', version: 2, mimeType: 'text/markdown', bookRunId: 12 },
        { id: 2, name: 'book.epub', version: 3, mimeType: 'application/json', bookRunId: 12 },
        {
          id: 3,
          name: 'audit_report.json',
          version: 4,
          mimeType: 'application/json',
          bookRunId: 12,
        },
      ],
    },
  ]);
  assert.deepEqual(toolCallWrites, []);
});

test('submitAssistantArtifactExport 成功后向已有 AssistantSession 追加导出摘要', async () => {
  const formData = new FormData();
  formData.set('book_run_id', '12');
  formData.set('assistant_session_id', '31');
  const events: string[] = [];

  await assert.rejects(
    () =>
      submitAssistantArtifactExport(formData, {
        readBookRun: async () => ({
          id: 12,
          workspace_id: 3,
          book_id: 5,
          blueprint_id: 9,
          status: 'completed',
          current_chapter_index: 3,
          total_chapters: 3,
          progress: {},
          checkpoint: [],
          token_budget: null,
          tokens_used: 100,
          time_budget_sec: null,
          elapsed_time_sec: 20,
          total_latency_ms: 0,
          max_latency_ms: 0,
          avg_latency_ms: 0,
          chapter_budget: 3,
          estimated_cost: 0.1,
          cost_summary: {},
        }),
        apiFetch: async (path, init) => {
          events.push(`${init.method ?? 'GET'} ${path}`);
          return new Response(
            JSON.stringify({
              id: events.length,
              name: `artifact-${events.length}`,
              version: events.length,
              mime_type: 'application/json',
              payload: { book_run_id: 12 },
            }),
            {
              status: 200,
            },
          );
        },
        revalidatePath: (path) => {
          events.push(`revalidate ${path}`);
        },
        writeAssistantArtifactExportSession: async (payload) => {
          events.push(`session ${JSON.stringify(payload)}`);
          return payload.assistantSessionId;
        },
        writeAssistantToolCall: async (payload) => {
          events.push(`tool ${JSON.stringify(payload)}`);
        },
        redirect: (url) => {
          events.push(`redirect ${url}`);
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error &&
      error.message.includes('book_run_id=12') &&
      error.message.includes('artifact_export_status=ok'),
  );

  assert.deepEqual(events, [
    'POST /api/book-runs/12/exports/markdown?workspace_id=3',
    'POST /api/book-runs/12/exports/epub?workspace_id=3',
    'POST /api/book-runs/12/exports/audit-report?workspace_id=3',
    'session {"bookRunId":12,"assistantSessionId":31,"artifacts":[{"id":1,"name":"artifact-1","version":1,"mimeType":"application/json","bookRunId":12},{"id":2,"name":"artifact-2","version":2,"mimeType":"application/json","bookRunId":12},{"id":3,"name":"artifact-3","version":3,"mimeType":"application/json","bookRunId":12}]}',
    'tool {"assistantSessionId":31,"toolName":"artifact.export","status":"completed","inputSummary":{"book_run_id":12},"outputSummary":{"summary":"artifact-1#1 v1（BookRun #12，Artifacts 下载摘要可查看）、artifact-2#2 v2（BookRun #12，Artifacts 下载摘要可查看）、artifact-3#3 v3（BookRun #12，Artifacts 下载摘要可查看）","artifact_ids":[1,2,3]},"relatedType":"book_run","relatedId":12}',
    'revalidate /',
    'redirect /?book_run_id=12&artifact_export_status=ok&artifact_export_summary=artifact-1%231+v1%EF%BC%88BookRun+%2312%EF%BC%8CArtifacts+%E4%B8%8B%E8%BD%BD%E6%91%98%E8%A6%81%E5%8F%AF%E6%9F%A5%E7%9C%8B%EF%BC%89%E3%80%81artifact-2%232+v2%EF%BC%88BookRun+%2312%EF%BC%8CArtifacts+%E4%B8%8B%E8%BD%BD%E6%91%98%E8%A6%81%E5%8F%AF%E6%9F%A5%E7%9C%8B%EF%BC%89%E3%80%81artifact-3%233+v3%EF%BC%88BookRun+%2312%EF%BC%8CArtifacts+%E4%B8%8B%E8%BD%BD%E6%91%98%E8%A6%81%E5%8F%AF%E6%9F%A5%E7%9C%8B%EF%BC%89&assistant_session_id=31',
  ]);
});

test('submitAssistantArtifactExport 新建会话后在 redirect 中回传 AssistantSession ID', async () => {
  const formData = new FormData();
  formData.set('book_run_id', '12');

  await assert.rejects(
    () =>
      submitAssistantArtifactExport(formData, {
        readBookRun: async () => ({
          id: 12,
          workspace_id: 3,
          book_id: 5,
          blueprint_id: 9,
          status: 'completed',
          current_chapter_index: 3,
          total_chapters: 3,
          progress: {},
          checkpoint: [],
          token_budget: null,
          tokens_used: 100,
          time_budget_sec: null,
          elapsed_time_sec: 20,
          total_latency_ms: 0,
          max_latency_ms: 0,
          avg_latency_ms: 0,
          chapter_budget: 3,
          estimated_cost: 0.1,
          cost_summary: {},
        }),
        apiFetch: async () =>
          new Response(JSON.stringify({ id: 1, name: 'artifact' }), { status: 200 }),
        revalidatePath: () => {},
        writeAssistantArtifactExportSession: async () => 44,
        writeAssistantToolCall: async (payload) => {
          assert.equal(payload.assistantSessionId, 44);
          assert.equal(payload.toolName, 'artifact.export');
          assert.equal(payload.status, 'completed');
        },
        redirect: (url) => {
          const redirected = new URL(url, 'http://storyforge.local');
          assert.equal(redirected.searchParams.get('assistant_session_id'), '44');
          assert.equal(redirected.searchParams.get('artifact_export_status'), 'ok');
          throw new Error('redirect-new-session');
        },
      }),
    (error) => error instanceof Error && error.message === 'redirect-new-session',
  );
});

test('submitAssistantArtifactExport 对缺失参数返回 invalid 且不写 AssistantSession', async () => {
  const formData = new FormData();
  formData.set('assistant_session_id', '31');
  let wroteSession = false;

  await assert.rejects(
    () =>
      submitAssistantArtifactExport(formData, {
        readBookRun: async () => {
          throw new Error('参数无效时不应读取 BookRun');
        },
        apiFetch: async () => {
          throw new Error('参数无效时不应导出');
        },
        revalidatePath: () => {},
        writeAssistantArtifactExportSession: async () => {
          wroteSession = true;
        },
        writeAssistantToolCall: async () => {
          throw new Error('缺少 book_run_id 时不应写 tool call');
        },
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error &&
      error.message === '/?artifact_export_status=invalid&assistant_session_id=31',
  );

  assert.equal(wroteSession, false);
});

test('submitAssistantArtifactExport 拒绝非 completed BookRun', async () => {
  const formData = new FormData();
  formData.set('book_run_id', '12');
  formData.set('assistant_session_id', '31');
  let wroteSession = false;

  await assert.rejects(
    () =>
      submitAssistantArtifactExport(formData, {
        readBookRun: async () => ({
          id: 12,
          workspace_id: 3,
          book_id: 5,
          blueprint_id: 9,
          status: 'running',
          current_chapter_index: 2,
          total_chapters: 3,
          progress: {},
          checkpoint: [],
          token_budget: null,
          tokens_used: 100,
          time_budget_sec: null,
          elapsed_time_sec: 20,
          total_latency_ms: 0,
          max_latency_ms: 0,
          avg_latency_ms: 0,
          chapter_budget: 3,
          estimated_cost: 0.1,
          cost_summary: {},
        }),
        apiFetch: async () => {
          throw new Error('非 completed BookRun 不应导出');
        },
        revalidatePath: () => {},
        writeAssistantArtifactExportSession: async () => {
          wroteSession = true;
        },
        writeAssistantToolCall: async () => {
          throw new Error('非 completed BookRun 不应写 tool call');
        },
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error &&
      error.message === '/?book_run_id=12&artifact_export_status=not_ready&assistant_session_id=31',
  );
  assert.equal(wroteSession, false);
});

test('submitAssistantArtifactExport 对导出 POST 失败回流 failed 状态', async () => {
  const formData = new FormData();
  formData.set('book_run_id', '12');
  formData.set('assistant_session_id', '31');
  const calls: string[] = [];
  let revalidated = false;
  let wroteSession = false;
  const toolCallWrites: unknown[] = [];

  await assert.rejects(
    () =>
      submitAssistantArtifactExport(formData, {
        readBookRun: async () => ({
          id: 12,
          workspace_id: 3,
          book_id: 5,
          blueprint_id: 9,
          status: 'completed',
          current_chapter_index: 3,
          total_chapters: 3,
          progress: {},
          checkpoint: [],
          token_budget: null,
          tokens_used: 100,
          time_budget_sec: null,
          elapsed_time_sec: 20,
          total_latency_ms: 0,
          max_latency_ms: 0,
          avg_latency_ms: 0,
          chapter_budget: 3,
          estimated_cost: 0.1,
          cost_summary: {},
        }),
        apiFetch: async (path, init) => {
          calls.push(`${init.method ?? 'GET'} ${path}`);
          return new Response('导出服务异常', { status: 500 });
        },
        revalidatePath: () => {
          revalidated = true;
        },
        writeAssistantArtifactExportSession: async () => {
          wroteSession = true;
        },
        writeAssistantToolCall: async (payload) => {
          toolCallWrites.push(payload);
        },
        redirect: (url) => {
          const redirected = new URL(url, 'http://storyforge.local');
          assert.equal(redirected.searchParams.get('book_run_id'), '12');
          assert.equal(redirected.searchParams.get('artifact_export_status'), 'failed');
          assert.equal(redirected.searchParams.get('assistant_session_id'), '31');
          const error = redirected.searchParams.get('artifact_export_error') ?? '';
          assert.ok(error.includes('500'), '失败回流应包含导出接口状态码');
          throw new Error('redirect-failed');
        },
      }),
    (error) => error instanceof Error && error.message === 'redirect-failed',
  );

  assert.deepEqual(calls, ['POST /api/book-runs/12/exports/markdown?workspace_id=3']);
  assert.equal(revalidated, false, '导出失败时不应刷新首页缓存');
  assert.equal(wroteSession, false, '导出失败时不应写入 AssistantSession');
  assert.deepEqual(toolCallWrites, [
    {
      assistantSessionId: 31,
      toolName: 'artifact.export',
      status: 'failed',
      inputSummary: { book_run_id: 12 },
      errorMessage: '导出失败：/api/book-runs/12/exports/markdown?workspace_id=3 返回 500',
      relatedType: 'book_run',
      relatedId: 12,
    },
  ]);
});
