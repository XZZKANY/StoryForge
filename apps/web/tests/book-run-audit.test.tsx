import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BookRunAuditPanel } from '../app/book-runs/audit';

const bookRun = {
  id: 12,
  book_id: 5,
  blueprint_id: 9,
  status: 'completed',
  current_chapter_index: 3,
  total_chapters: 3,
  progress: {
    completed_chapters: [
      {
        chapter_index: 1,
        model_run_id: 11,
        judge_report_id: 12,
        repair_patch_id: 13,
        approved_scene_id: 14,
        memory_extract_id: 15,
        quality_score: 82,
        quality_issues: [{ dimension: '说明腔', severity: '中', message: '情绪直述' }],
      },
      {
        chapter_index: 2,
        model_run_id: 21,
        judge_report_id: 22,
        repair_patch_id: null,
        approved_scene_id: 24,
        memory_extract_id: 25,
        quality_score: 68,
        quality_issues: [{ dimension: '连续性', severity: '严重', message: '事实冲突' }],
        manual_review_recommendation: '连续性需要人工复核。',
      },
    ],
  },
  checkpoint: [],
  token_budget: 1200,
  tokens_used: 840,
  time_budget_sec: 300,
  elapsed_time_sec: 120,
  chapter_budget: 3,
  estimated_cost: 0.42,
  cost_summary: { tokens_remaining: 360 },
  quality_summary: {
    overall_quality_score: 75,
    chapter_count: 2,
    issue_count: 2,
    severe_issue_count: 1,
  },
};

test('BookRun 审计面板按章节展示关键证据链', () => {
  const html = renderToStaticMarkup(React.createElement(BookRunAuditPanel, { bookRun }));

  assert.ok(html.includes('BookRun 审计'));
  assert.ok(html.includes('章节 1'));
  assert.ok(html.includes('generate'));
  assert.ok(html.includes('model_run_id=11'));
  assert.ok(html.includes('href="/runs?model_run_id=11"'));
  assert.ok(html.includes('judge_report_id=12'));
  assert.ok(html.includes('href="/evaluations?judge_report_id=12"'));
  assert.ok(html.includes('repair_patch_id=13'));
  assert.ok(html.includes('href="/artifacts?repair_patch_id=13"'));
  assert.ok(html.includes('approved_scene_id='));
  assert.ok(html.includes('href="/studio?scene_id=14"'));
  assert.ok(html.includes('memory_extract_id='));
  assert.ok(html.includes('href="/worldbuilding?memory_atom_id=15"'));
  assert.ok(html.includes('质量摘要'));
  assert.ok(html.includes('综合质量分'));
  assert.ok(html.includes('75'));
  assert.ok(html.includes('章节质量分：82'));
  assert.ok(html.includes('说明腔'));
  assert.ok(html.includes('连续性需要人工复核。'));
});

test('BookRun 审计面板无质量数据时展示空态', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookRunAuditPanel, {
      bookRun: { ...bookRun, quality_summary: undefined, progress: { completed_chapters: [] } },
    }),
  );

  assert.ok(html.includes('暂无质量摘要'));
});
