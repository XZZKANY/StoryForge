import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BlueprintWorkbench,
  createBlueprintRequest,
  createBookRunRequest,
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

  assert.deepEqual(triggerChapterPlanRequest(9), {
    path: '/api/blueprints/9/chapter-plan',
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
