import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BlueprintWorkbench,
  createBlueprintRequest,
  createBookRunRequest,
  createBlueprintWorkflowAction,
  lockBlueprintRequest,
  triggerChapterPlanRequest,
} from '../app/blueprints/api';

test('Blueprint API helper 使用正确 endpoint 和 payload', () => {
  assert.deepEqual(createBlueprintRequest(5), {
    path: '/api/blueprints',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        book_id: 5,
        premise: '林岚在雾港追查失真的灯塔信号。',
        tone: '克制悬疑',
        target_word_count: 4500,
        target_chapter_count: 3,
        chapter_word_count_min: 1000,
        chapter_word_count_max: 1800,
        metadata: { pov: '林岚', location: '雾港' },
      }),
    },
  });
});

test('Blueprint API helper 可从 Assistant intent 生成非固定三章请求', () => {
  const request = createBlueprintRequest(7, {
    taskType: 'trial_generation',
    premise: '写 10 章短篇，主角在海底城追查失踪的钟声',
    tone: '悬疑',
    targetWordCount: 50000,
    targetChapterCount: 10,
    volumeCount: 2,
    batchChapterCount: 3,
    continuationMode: 'new_book',
    requestedArtifacts: ['blueprint', 'chapters', 'review', 'repair'],
  });

  assert.equal(request.path, '/api/blueprints');
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    book_id: 7,
    premise: '写 10 章短篇，主角在海底城追查失踪的钟声',
    tone: '悬疑',
    target_word_count: 50000,
    target_chapter_count: 10,
    chapter_word_count_min: 1000,
    chapter_word_count_max: 1800,
    metadata: {
      assistant_task_type: 'trial_generation',
      requested_artifacts: ['blueprint', 'chapters', 'review', 'repair'],
      continuation_mode: 'new_book',
      batch_chapter_count: 3,
      volume_count: 2,
    },
  });

  assert.deepEqual(triggerChapterPlanRequest(9), {
    path: '/api/blueprints/9/chapter-plan',
    init: { method: 'POST' },
  });
  assert.deepEqual(lockBlueprintRequest(9), {
    path: '/api/blueprints/9/lock',
    init: { method: 'POST' },
  });
  assert.deepEqual(createBookRunRequest(5, 9), {
    path: '/api/book-runs',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ book_id: 5, blueprint_id: 9 }),
    },
  });
  assert.deepEqual(createBookRunRequest(5, 9, { chapterBudget: 3, tokenBudget: 12000 }), {
    path: '/api/book-runs',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        book_id: 5,
        blueprint_id: 9,
        chapter_budget: 3,
        token_budget: 12000,
      }),
    },
  });
});

test('Blueprint 页面保留独立工作台容器', () => {
  const page = readFileSync(join(process.cwd(), 'app/blueprints/page.tsx'), 'utf8');
  const panel = readFileSync(
    join(process.cwd(), 'app/blueprints/BlueprintWorkspacePanel.tsx'),
    'utf8',
  );

  assert.ok(page.includes('BlueprintWorkspacePanel'), '旧 /blueprints 应复用工作台容器');
  assert.ok(panel.includes('readBlueprint'), '工作台容器应读取 Blueprint 详情');
  assert.ok(panel.includes('readBookRun'), '工作台容器应读取 BookRun 详情');
  assert.ok(panel.includes('BlueprintWorkbench'), '工作台容器应渲染真实 BlueprintWorkbench');
  assert.ok(panel.includes('最小操作链'), '工作台容器应保留最小操作链');
  assert.ok(panel.includes('锁定 Blueprint'), '工作台容器应展示锁定步骤');
  assert.ok(
    panel.includes('form action={createBlueprintWorkflowAction}'),
    '工作台容器应提供可提交操作',
  );
  assert.ok(panel.includes('name="blueprint_action"'), '工作台操作应声明动作类型');
  assert.ok(panel.includes('searchParams?.intent'), '工作台应读取 URL 中的 Assistant intent');
  assert.ok(panel.includes('name="intent"'), '创建 Blueprint 表单应把 intent 传给 Server Action');
});

test('Blueprint 工作台 Server Action 创建 Blueprint 时消费 Assistant intent', async () => {
  const formData = new FormData();
  formData.set('book_id', '5');
  formData.set('blueprint_action', 'create-blueprint');
  formData.set('intent', '写 10 章短篇，分 2 卷，目标 3-5 万字，先生成前三章');

  await assert.rejects(
    () =>
      createBlueprintWorkflowAction(formData, {
        apiFetch: async (path, init) => {
          assert.equal(path, '/api/blueprints');
          assert.equal(init.method, 'POST');
          assert.deepEqual(JSON.parse(String(init.body)), {
            book_id: 5,
            premise: '写 10 章短篇，分 2 卷，目标 3-5 万字，先生成前三章',
            tone: '短篇',
            target_word_count: 50000,
            target_chapter_count: 10,
            chapter_word_count_min: 1000,
            chapter_word_count_max: 1800,
            metadata: {
              assistant_task_type: 'trial_generation',
              requested_artifacts: ['blueprint', 'chapters', 'review', 'repair'],
              continuation_mode: 'new_book',
              batch_chapter_count: 3,
              volume_count: 2,
            },
          });
          return new Response(
            JSON.stringify({
              id: 21,
              book_id: 5,
              premise: '写 10 章短篇，分 2 卷，目标 3-5 万字，先生成前三章',
              tone: '短篇',
              target_word_count: 50000,
              target_chapter_count: 10,
              chapter_word_count_min: 1000,
              chapter_word_count_max: 1800,
              status: 'draft',
              version: 1,
              metadata: {},
            }),
            { status: 201 },
          );
        },
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) => error instanceof Error && error.message === '/?view=projects&blueprint_id=21',
  );
});

test('Blueprint 工作台 Server Action 串联创建、锁定、章节计划和 BookRun 请求', async () => {
  const formData = new FormData();
  formData.set('book_id', '5');
  formData.set('blueprint_id', '9');
  formData.set('blueprint_action', 'start-book-run');

  await assert.rejects(
    () =>
      createBlueprintWorkflowAction(formData, {
        apiFetch: async (path, init) => {
          assert.equal(path, '/api/book-runs');
          assert.equal(init.method, 'POST');
          return new Response(
            JSON.stringify({
              id: 12,
              book_id: 5,
              blueprint_id: 9,
              status: 'queued',
              current_chapter_index: 1,
              total_chapters: 3,
              progress: {},
              checkpoint: [],
              token_budget: null,
              tokens_used: 0,
              time_budget_sec: null,
              elapsed_time_sec: 0,
              chapter_budget: null,
              estimated_cost: 0,
              cost_summary: {},
            }),
            { status: 201 },
          );
        },
        redirect: (url) => {
          throw new Error(url);
        },
      }),
    (error) =>
      error instanceof Error && error.message === '/?view=projects&blueprint_id=9&book_run_id=12',
  );
});

test('BlueprintWorkbench 渲染 Blueprint 和 BookRun 状态', () => {
  const html = renderToStaticMarkup(
    React.createElement(BlueprintWorkbench, {
      blueprint: {
        id: 9,
        book_id: 5,
        premise: '林岚在雾港追查失真的灯塔信号。',
        tone: '克制悬疑',
        target_word_count: 4500,
        target_chapter_count: 3,
        chapter_word_count_min: 1000,
        chapter_word_count_max: 1800,
        status: 'locked',
        version: 2,
        metadata: { pov: '林岚' },
      },
      bookRun: {
        id: 12,
        book_id: 5,
        blueprint_id: 9,
        status: 'completed',
        current_chapter_index: 3,
        total_chapters: 3,
        progress: { completed_chapters: [{ chapter_index: 1 }] },
        checkpoint: [{ chapter_index: 1 }],
        token_budget: 1200,
        tokens_used: 840,
        time_budget_sec: 300,
        elapsed_time_sec: 120,
        chapter_budget: 3,
        estimated_cost: 0.42,
        cost_summary: { tokens_remaining: 360, estimated_cost: 0.42 },
      },
    }),
  );

  assert.ok(html.includes('Blueprint #9'));
  assert.ok(html.includes('BookRun #12'));
  assert.ok(html.includes('completed'));
  assert.ok(html.includes('3 / 3'));
  assert.ok(html.includes('840 / 1200'));
  assert.ok(html.includes('360'));
  assert.ok(html.includes('0.42'));
});
