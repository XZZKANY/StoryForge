import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BookRunStatusPanel,
  exportAuditReportRequest,
  exportEpubRequest,
  exportMarkdownRequest,
} from '../app/book-runs/api';

test('BookRun 状态页组件展示运行进度和最近事件', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookRunStatusPanel, {
      bookRun: {
        id: 12,
        book_id: 5,
        blueprint_id: 9,
        status: 'completed',
        current_chapter_index: 3,
        total_chapters: 3,
        progress: {
          completed_chapters: [
            { chapter_index: 1, model_run_id: 11, judge_report_id: 12, approved_scene_id: 13 },
            { chapter_index: 2, model_run_id: 21, judge_report_id: 22, approved_scene_id: 23 },
            { chapter_index: 3, model_run_id: 31, judge_report_id: 32, approved_scene_id: 33 },
          ],
        },
        checkpoint: [
          { chapter_index: 3, model_run_id: 31, judge_report_id: 32, approved_scene_id: 33 },
        ],
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

  assert.ok(html.includes('BookRun #12'));
  assert.ok(html.includes('completed'));
  assert.ok(html.includes('3 / 3'));
  assert.ok(html.includes('840 / 1200'));
  assert.ok(html.includes('章节 3'));
  assert.ok(html.includes('model_run_id=31'));
  assert.ok(html.includes('judge_report_id=32'));
});

test('BookRun 导出 helper 使用正确 endpoint', () => {
  assert.deepEqual(exportMarkdownRequest(12), {
    path: '/api/book-runs/12/exports/markdown',
    init: { method: 'POST' },
  });
  assert.deepEqual(exportAuditReportRequest(12), {
    path: '/api/book-runs/12/exports/audit-report',
    init: { method: 'POST' },
  });
  assert.deepEqual(exportEpubRequest(12), {
    path: '/api/book-runs/12/exports/epub',
    init: { method: 'POST' },
  });
});
