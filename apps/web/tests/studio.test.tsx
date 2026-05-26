import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StudioFlow, type StudioFlowStep } from '../app/studio/StudioFlow';
import { buildApprovalRequestBody, submitStudioApproval } from '../app/studio/approval-action-core';

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
  const calls: Array<{ readonly path: string; readonly init: RequestInit }> = [];
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
        redirect: (url) => {
          throw new RedirectSignal(url);
        },
      }),
    (error) => error instanceof RedirectSignal && error.url.includes('writeback_status='),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/studio/approve');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(
    (calls[0].init.headers as Record<string, string>)['content-type'],
    'application/json',
  );
  assert.equal(calls[0].init.body, JSON.stringify({ repair_patch_id: 17 }));
  assert.equal(revalidatedPath, '/studio');
});
