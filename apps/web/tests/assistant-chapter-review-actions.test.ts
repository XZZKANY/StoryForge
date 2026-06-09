import assert from 'node:assert/strict';
import { test } from 'node:test';

import { submitAssistantChapterReview } from '../components/home/assistant-chapter-review-actions';

test('submitAssistantChapterReview 主动创建 Judge、Repair 并读取批准摘要', async () => {
  const formData = new FormData();
  formData.set('scene_packet_id', '42');
  const calls: string[] = [];
  const sessionWrites: unknown[] = [];
  const toolCallWrites: unknown[] = [];

  await assert.rejects(
    () =>
      submitAssistantChapterReview(formData, {
        apiFetch: async (path, init) => {
          calls.push(`${init.method ?? 'GET'} ${path} ${String(init.body ?? '')}`);
          return new Response(
            JSON.stringify({
              judge_review: { status: 'pass', score: 92, issue_count: 1 },
              repair_patches: [{ id: 17, status: 'draft', requires_rejudge: true }],
              approval_summary: {
                approval_status: 'ready',
                approvable_object: { object_type: 'repair_patch', id: 17 },
              },
            }),
            { status: 200 },
          );
        },
        revalidatePath: () => {},
        writeAssistantChapterReviewSession: async (payload) => {
          sessionWrites.push(payload);
        },
        writeAssistantToolCall: async (payload) => {
          toolCallWrites.push(payload);
        },
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error &&
      error.message === '/?scene_packet_id=42&chapter_review_status=ready&repair_patch_id=17',
  );

  assert.deepEqual(calls, ['POST /api/studio/chapter-review {"scene_packet_id":42}']);
  assert.deepEqual(sessionWrites, [
    {
      scenePacketId: 42,
      repairPatchId: 17,
      summary: { issues: [], repairPatch: undefined },
      assistantSessionId: undefined,
    },
  ]);
  assert.deepEqual(toolCallWrites, []);
});

test('submitAssistantChapterReview 可先按作品和章节序号定位 Scene Packet', async () => {
  const formData = new FormData();
  formData.set('book_id', '5');
  formData.set('target_chapter_ordinal', '2');
  const calls: string[] = [];

  await assert.rejects(
    () =>
      submitAssistantChapterReview(formData, {
        apiFetch: async (path, init) => {
          calls.push(
            `${init.method ?? 'GET'} ${path} ${JSON.stringify(init.params ?? {})} ${String(
              init.body ?? '',
            )}`,
          );
          if (path === '/api/studio/scene-packets') {
            return new Response(
              JSON.stringify({
                book_id: 5,
                target_chapter_ordinal: 2,
                scene_id: 9,
                scene_packet_id: 42,
                job_run_id: null,
                status: 'assembled',
                chapter_goal: '审阅第二章。',
                evidence_count: 1,
                compiled_context_id: null,
                budget_summary: {},
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              judge_review: { status: 'clean', score: 100, issue_count: 0, issues: [] },
              repair_patches: [],
              approval_summary: { approval_status: 'ready' },
            }),
            { status: 200 },
          );
        },
        revalidatePath: () => {},
        writeAssistantChapterReviewSession: async () => 31,
        writeAssistantToolCall: async (payload) => {
          assert.equal(payload.assistantSessionId, 31);
          assert.equal(payload.toolName, 'chapter.review');
          assert.equal(payload.status, 'completed');
          assert.deepEqual(payload.inputSummary, { scene_packet_id: 42 });
          assert.equal(payload.relatedType, 'scene_packet');
          assert.equal(payload.relatedId, 42);
        },
        redirect: (url) => {
          const redirected = new URL(url, 'http://storyforge.local');
          assert.equal(redirected.searchParams.get('scene_packet_id'), '42');
          assert.equal(redirected.searchParams.get('book_id'), '5');
          assert.equal(redirected.searchParams.get('target_chapter_ordinal'), '2');
          assert.equal(redirected.searchParams.get('chapter_review_status'), 'ready');
          assert.equal(redirected.searchParams.get('assistant_session_id'), '31');
          throw new Error('redirect-located-scene-packet');
        },
      }),
    (error) => error instanceof Error && error.message === 'redirect-located-scene-packet',
  );

  assert.deepEqual(calls, [
    'GET /api/studio/scene-packets {"book_id":5,"target_ordinal":2} ',
    'POST /api/studio/chapter-review {} {"scene_packet_id":42}',
  ]);
});

test('submitAssistantChapterReview 将 Judge 和 Repair 摘要压缩进安全短参数', async () => {
  const formData = new FormData();
  formData.set('scene_packet_id', '42');
  const sensitiveChapterBody = '她在雨夜里独白了整整三页，这是原文章节正文，不应进入 URL。';

  await assert.rejects(
    () =>
      submitAssistantChapterReview(formData, {
        apiFetch: async (path) => {
          assert.equal(path, '/api/studio/chapter-review');
          return new Response(
            JSON.stringify({
              judge_review: {
                status: 'needs_repair',
                issues: [
                  {
                    summary: '动机转折缺少铺垫',
                    severity: 'high',
                    evidence: [{ reference: '第 3 场对白', excerpt: sensitiveChapterBody }],
                    content: sensitiveChapterBody,
                  },
                ],
              },
              repair_patches: [
                {
                  id: 17,
                  status: 'draft',
                  requires_rejudge: true,
                  summary: '补一段行动前的犹豫和外部压力。',
                  patch: sensitiveChapterBody,
                },
              ],
              approval_summary: {
                approval_status: 'ready',
                approvable_object: { object_type: 'repair_patch', id: 17 },
              },
            }),
            { status: 200 },
          );
        },
        revalidatePath: () => {},
        writeAssistantChapterReviewSession: async () => {},
        redirect: (url) => {
          const redirected = new URL(url, 'http://storyforge.local');
          assert.equal(redirected.searchParams.get('chapter_review_status'), 'ready');
          assert.equal(redirected.searchParams.get('repair_patch_id'), '17');
          assert.ok(url.length <= 700, '章节审阅摘要 URL 应保持短小');
          assert.ok(!url.includes(sensitiveChapterBody), 'URL 不应包含章节正文或补丁全文');
          const summary = redirected.searchParams.get('chapter_review_summary') ?? '';
          assert.ok(summary.includes('动机转折缺少铺垫'));
          assert.ok(summary.includes('high'));
          assert.ok(summary.includes('第 3 场对白'));
          assert.ok(summary.includes('补一段行动前的犹豫和外部压力。'));
          throw new Error('redirect-with-summary');
        },
      }),
    (error) => error instanceof Error && error.message === 'redirect-with-summary',
  );
});

test('submitAssistantChapterReview 成功后向已有 AssistantSession 追加章节审阅消息', async () => {
  const formData = new FormData();
  formData.set('scene_packet_id', '42');
  formData.set('assistant_session_id', '31');
  const events: string[] = [];

  await assert.rejects(
    () =>
      submitAssistantChapterReview(formData, {
        apiFetch: async (path, init) => {
          events.push(`${init.method ?? 'GET'} ${path}`);
          return new Response(
            JSON.stringify({
              judge_review: {
                issues: [{ summary: '动机转折缺少铺垫', severity: 'high' }],
              },
              repair_patches: [{ id: 17, summary: '补足行动前压力。' }],
              approval_summary: { approval_status: 'ready' },
            }),
            { status: 200 },
          );
        },
        revalidatePath: (path) => {
          events.push(`revalidate ${path}`);
        },
        writeAssistantChapterReviewSession: async (payload) => {
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
      error.message.includes('scene_packet_id=42') &&
      error.message.includes('chapter_review_status=ready') &&
      error.message.includes('repair_patch_id=17'),
  );

  assert.deepEqual(events, [
    'POST /api/studio/chapter-review',
    'session {"scenePacketId":42,"repairPatchId":17,"summary":{"issues":[{"summary":"动机转折缺少铺垫","severity":"high"}],"repairPatch":"补足行动前压力。"},"assistantSessionId":31}',
    'tool {"assistantSessionId":31,"toolName":"chapter.review","status":"completed","inputSummary":{"scene_packet_id":42},"outputSummary":{"summary":"动机转折缺少铺垫，级别 high；修复 补足行动前压力。","repair_patch_id":17},"relatedType":"scene_packet","relatedId":42}',
    'revalidate /',
    'redirect /?scene_packet_id=42&chapter_review_status=ready&repair_patch_id=17&assistant_session_id=31&chapter_review_summary=%7B%22issues%22%3A%5B%7B%22summary%22%3A%22%E5%8A%A8%E6%9C%BA%E8%BD%AC%E6%8A%98%E7%BC%BA%E5%B0%91%E9%93%BA%E5%9E%AB%22%2C%22severity%22%3A%22high%22%7D%5D%2C%22repairPatch%22%3A%22%E8%A1%A5%E8%B6%B3%E8%A1%8C%E5%8A%A8%E5%89%8D%E5%8E%8B%E5%8A%9B%E3%80%82%22%7D',
  ]);
});

test('submitAssistantChapterReview 新建会话后在 redirect 中回传 AssistantSession ID', async () => {
  const formData = new FormData();
  formData.set('scene_packet_id', '42');

  await assert.rejects(
    () =>
      submitAssistantChapterReview(formData, {
        apiFetch: async (path) => {
          assert.equal(path, '/api/studio/chapter-review');
          return new Response(
            JSON.stringify({
              judge_review: { status: 'clean', issues: [] },
              repair_patches: [],
              approval_summary: { approval_status: 'ready' },
            }),
            { status: 200 },
          );
        },
        revalidatePath: () => {},
        writeAssistantChapterReviewSession: async () => 44,
        writeAssistantToolCall: async (payload) => {
          assert.equal(payload.assistantSessionId, 44);
          assert.equal(payload.status, 'completed');
        },
        redirect: (url) => {
          const redirected = new URL(url, 'http://storyforge.local');
          assert.equal(redirected.searchParams.get('assistant_session_id'), '44');
          assert.equal(redirected.searchParams.get('chapter_review_status'), 'ready');
          throw new Error('redirect-new-session');
        },
      }),
    (error) => error instanceof Error && error.message === 'redirect-new-session',
  );
});

test('submitAssistantChapterReview 缺少 Scene Packet 时要求选择章节', async () => {
  const sessionWrites: unknown[] = [];
  const formData = new FormData();
  formData.set('assistant_session_id', '31');

  await assert.rejects(
    () =>
      submitAssistantChapterReview(formData, {
        apiFetch: async () => {
          throw new Error('缺少 scene_packet_id 时不应调用 API');
        },
        revalidatePath: () => {},
        writeAssistantChapterReviewSession: async (payload) => {
          sessionWrites.push(payload);
        },
        writeAssistantToolCall: async () => {
          throw new Error('缺少 scene_packet_id 时不应写 tool call');
        },
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error &&
      error.message === '/?chapter_review_status=select_chapter&assistant_session_id=31',
  );
  assert.deepEqual(sessionWrites, []);
});

test('submitAssistantChapterReview 有章节序号但缺少作品时要求选择作品', async () => {
  const formData = new FormData();
  formData.set('target_chapter_ordinal', '2');
  formData.set('assistant_session_id', '31');

  await assert.rejects(
    () =>
      submitAssistantChapterReview(formData, {
        apiFetch: async () => {
          throw new Error('缺少 book_id 时不应调用 API');
        },
        revalidatePath: () => {},
        writeAssistantToolCall: async () => {
          throw new Error('缺少 book_id 时不应写 tool call');
        },
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error &&
      error.message ===
        '/?chapter_review_status=select_book&target_chapter_ordinal=2&assistant_session_id=31',
  );
});

test('submitAssistantChapterReview 章节定位失败时回流可读错误', async () => {
  const formData = new FormData();
  formData.set('book_id', '5');
  formData.set('target_chapter_ordinal', '2');
  const sessionWrites: unknown[] = [];

  await assert.rejects(
    () =>
      submitAssistantChapterReview(formData, {
        apiFetch: async (path) => {
          assert.equal(path, '/api/studio/scene-packets');
          return new Response(JSON.stringify({ detail: 'Scene Packet 不存在' }), { status: 404 });
        },
        revalidatePath: () => {},
        writeAssistantChapterReviewSession: async (payload) => {
          sessionWrites.push(payload);
        },
        writeAssistantToolCall: async () => {
          throw new Error('定位失败时尚未获得 scene_packet_id，不应写 tool call');
        },
        redirect: (url) => {
          const redirected = new URL(url, 'http://storyforge.local');
          assert.equal(redirected.searchParams.get('chapter_review_status'), 'failed');
          assert.equal(redirected.searchParams.get('book_id'), '5');
          assert.equal(redirected.searchParams.get('target_chapter_ordinal'), '2');
          assert.match(
            redirected.searchParams.get('chapter_review_error') ?? '',
            /章节审阅 API 返回 404/,
          );
          throw new Error('redirect-locate-failed');
        },
      }),
    (error) => error instanceof Error && error.message === 'redirect-locate-failed',
  );
  assert.deepEqual(sessionWrites, []);
});

test('submitAssistantChapterReview 将 Studio API 失败回流为 Assistant 可读状态', async () => {
  const formData = new FormData();
  formData.set('scene_packet_id', '42');
  formData.set('assistant_session_id', '31');
  const sessionWrites: unknown[] = [];
  const toolCallWrites: unknown[] = [];

  await assert.rejects(
    () =>
      submitAssistantChapterReview(formData, {
        apiFetch: async () =>
          new Response(JSON.stringify({ detail: 'Judge 服务暂不可用' }), { status: 500 }),
        revalidatePath: () => {},
        writeAssistantChapterReviewSession: async (payload) => {
          sessionWrites.push(payload);
        },
        writeAssistantToolCall: async (payload) => {
          toolCallWrites.push(payload);
        },
        redirect: (url) => {
          const redirected = new URL(url, 'http://storyforge.local');
          assert.equal(redirected.searchParams.get('scene_packet_id'), '42');
          assert.equal(redirected.searchParams.get('chapter_review_status'), 'failed');
          assert.equal(redirected.searchParams.get('assistant_session_id'), '31');
          assert.match(
            redirected.searchParams.get('chapter_review_error') ?? '',
            /章节审阅 API 返回 500/,
          );
          throw new Error('redirect-failed');
        },
      }),
    (error) => error instanceof Error && error.message === 'redirect-failed',
  );
  assert.deepEqual(sessionWrites, []);
  assert.deepEqual(toolCallWrites, [
    {
      assistantSessionId: 31,
      toolName: 'chapter.review',
      status: 'failed',
      inputSummary: { scene_packet_id: 42 },
      errorMessage: '章节审阅 API 返回 500：/api/studio/chapter-review',
      relatedType: 'scene_packet',
      relatedId: 42,
    },
  ]);
});
