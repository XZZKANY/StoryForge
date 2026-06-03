import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StudioFlow, type StudioFlowStep } from '../app/studio/StudioFlow';
import {
  buildApprovalRequestBody,
  buildApprovalResultUrl,
  type StudioApprovalSessionWrite,
  submitStudioApproval,
} from '../app/studio/approval-action-core';

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

function createStudioSteps(): StudioFlowStep[] {
  return [
    {
      id: 'book',
      label: '选作品',
      title: '选作品',
      description: '选择测试作品',
      completed: true,
      content: React.createElement('p', null, '作品已选择'),
    },
    {
      id: 'goal',
      label: '设目标',
      title: '设目标',
      description: '确认章节目标',
      completed: true,
      content: React.createElement('p', null, '目标已确认'),
    },
    {
      id: 'generate',
      label: '生成',
      title: '生成 Scene Packet',
      description: '生成测试上下文',
      completed: false,
      content: React.createElement('p', null, '等待生成'),
    },
    {
      id: 'review',
      label: '评审并批准',
      title: '评审并批准',
      description: '提交批准写回',
      completed: false,
      content: React.createElement('p', null, '等待评审'),
    },
  ];
}

test('StudioFlow 可以渲染四步流程且不崩溃', () => {
  const html = renderToStaticMarkup(
    React.createElement(StudioFlow, { steps: createStudioSteps() }),
  );

  assert.ok(html.includes('Studio 操作流程'));
  assert.ok(html.includes('Step 1'));
  assert.ok(html.includes('Step 4'));
  assert.ok(html.includes('生成 Scene Packet'));
});

test('批准写回表单拒绝空输入', () => {
  const result = buildApprovalRequestBody(new FormData());

  assert.equal(result.status, 'invalid');
  const params = new URLSearchParams(result.redirectUrl.replace('/studio?', ''));
  assert.equal(params.get('unavailable_reason'), '需要提供 Scene Packet ID 或 Repair Patch ID。');
});

test('批准写回提交使用正确 API payload', async () => {
  const formData = new FormData();
  formData.set('repair_patch_id', '17');
  formData.set('assistant_session_id', '31');
  const calls: Array<{ readonly path: string; readonly init: RequestInit }> = [];
  const sessionWrites: StudioApprovalSessionWrite[] = [];
  let revalidatedPath: string | undefined;

  await assert.rejects(
    () =>
      submitStudioApproval(formData, {
        endpoint: '/api/studio/approve',
        apiFetch: async (path, init) => {
          calls.push({ path, init });
          return new Response(
            JSON.stringify({
              writeback_status: '已写回',
              approved_chapter_id: 5,
              continuity_update_summary: '连续性已更新',
              unavailable_reason: null,
            }),
            { status: 200 },
          );
        },
        revalidatePath: (path) => {
          revalidatedPath = path;
        },
        writeAssistantApprovalSession: async (payload) => {
          sessionWrites.push(payload);
        },
        redirect: (url) => {
          throw new RedirectSignal(url);
        },
      }),
    (error) => {
      if (!(error instanceof RedirectSignal)) return false;
      const params = new URLSearchParams(error.url.replace('/studio?', ''));
      return (
        params.get('writeback_status') === '已写回' && params.get('assistant_session_id') === '31'
      );
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/studio/approve');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(
    (calls[0].init.headers as Record<string, string>)['content-type'],
    'application/json',
  );
  assert.equal(calls[0].init.body, JSON.stringify({ repair_patch_id: 17 }));
  assert.deepEqual(sessionWrites, [
    {
      assistantSessionId: 31,
      writebackStatus: '已写回',
      approvedChapterId: 5,
      repairPatchId: 17,
      scenePacketId: undefined,
      summary: '连续性已更新',
    },
  ]);
  assert.equal(revalidatedPath, '/studio');
});

test('批准写回成功且无 AssistantSession 时请求创建新会话', async () => {
  const formData = new FormData();
  formData.set('scene_packet_id', '42');
  const sessionWrites: StudioApprovalSessionWrite[] = [];

  await assert.rejects(
    () =>
      submitStudioApproval(formData, {
        endpoint: '/api/studio/approve',
        apiFetch: async () =>
          new Response(
            JSON.stringify({
              writeback_status: '已写回',
              approved_chapter_id: 9,
              continuity_update_summary: '只保留短摘要',
              unavailable_reason: null,
            }),
            { status: 200 },
          ),
        revalidatePath: () => {},
        writeAssistantApprovalSession: async (payload) => {
          sessionWrites.push(payload);
        },
        redirect: (url) => {
          throw new RedirectSignal(url);
        },
      }),
    (error) => error instanceof RedirectSignal,
  );

  assert.deepEqual(sessionWrites, [
    {
      assistantSessionId: undefined,
      writebackStatus: '已写回',
      approvedChapterId: 9,
      repairPatchId: undefined,
      scenePacketId: 42,
      summary: '只保留短摘要',
    },
  ]);
});

test('批准写回失败路径不写 AssistantSession', async () => {
  const invalidFormData = new FormData();
  invalidFormData.set('scene_packet_id', '42');
  invalidFormData.set('repair_patch_id', '17');
  invalidFormData.set('assistant_session_id', '31');
  const apiFailedFormData = new FormData();
  apiFailedFormData.set('repair_patch_id', '17');
  apiFailedFormData.set('assistant_session_id', '31');
  const invalidResponseFormData = new FormData();
  invalidResponseFormData.set('repair_patch_id', '18');
  invalidResponseFormData.set('assistant_session_id', '31');
  const exceptionFormData = new FormData();
  exceptionFormData.set('repair_patch_id', '19');
  exceptionFormData.set('assistant_session_id', '31');
  const sessionWrites: StudioApprovalSessionWrite[] = [];
  const writeAssistantApprovalSession = async (payload: StudioApprovalSessionWrite) => {
    sessionWrites.push(payload);
  };
  const redirect = (url: string): never => {
    throw new RedirectSignal(url);
  };

  await assert.rejects(
    () =>
      submitStudioApproval(invalidFormData, {
        endpoint: '/api/studio/approve',
        apiFetch: async () => {
          throw new Error('不应调用 API');
        },
        revalidatePath: () => {},
        writeAssistantApprovalSession,
        redirect,
      }),
    (error) =>
      error instanceof RedirectSignal &&
      new URLSearchParams(error.url.replace('/studio?', '')).get('assistant_session_id') === '31',
  );

  await assert.rejects(
    () =>
      submitStudioApproval(apiFailedFormData, {
        endpoint: '/api/studio/approve',
        apiFetch: async () => new Response('{}', { status: 500 }),
        revalidatePath: () => {},
        writeAssistantApprovalSession,
        redirect,
      }),
    (error) =>
      error instanceof RedirectSignal &&
      new URLSearchParams(error.url.replace('/studio?', '')).get('assistant_session_id') === '31',
  );

  await assert.rejects(
    () =>
      submitStudioApproval(invalidResponseFormData, {
        endpoint: '/api/studio/approve',
        apiFetch: async () =>
          new Response(JSON.stringify({ writeback_status: '缺少字段' }), { status: 200 }),
        revalidatePath: () => {},
        writeAssistantApprovalSession,
        redirect,
      }),
    (error) =>
      error instanceof RedirectSignal &&
      new URLSearchParams(error.url.replace('/studio?', '')).get('assistant_session_id') === '31',
  );

  await assert.rejects(
    () =>
      submitStudioApproval(exceptionFormData, {
        endpoint: '/api/studio/approve',
        apiFetch: async () => {
          throw new Error('网络异常');
        },
        revalidatePath: () => {},
        writeAssistantApprovalSession,
        redirect,
      }),
    (error) =>
      error instanceof RedirectSignal &&
      new URLSearchParams(error.url.replace('/studio?', '')).get('assistant_session_id') === '31',
  );

  assert.deepEqual(sessionWrites, []);
});

test('批准写回结果 URL 可注入首页 projects 子页并保留 book_id', () => {
  const url = buildApprovalResultUrl(
    {
      writeback_status: '已写回',
      approved_chapter_id: 5,
      continuity_update_summary: '连续性已更新',
    },
    { pathname: '/', view: 'projects', bookId: 8, assistantSessionId: 31 },
  );

  assert.ok(url.startsWith('/?'), '首页 projects 回跳应留在根路径');
  const params = new URLSearchParams(url.replace('/?', ''));
  assert.equal(params.get('view'), 'projects');
  assert.equal(params.get('book_id'), '8');
  assert.equal(params.get('assistant_session_id'), '31');
  assert.equal(params.get('approval_submitted'), '1');
  assert.equal(params.get('writeback_status'), '已写回');
});
