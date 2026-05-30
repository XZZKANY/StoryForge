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
    quality_summary: { average_score: 89, status: 'needs_review', issue_count: 1 },
    chapter_quality_scores: [{ chapter_index: 1, quality_score: 91 }],
    top_quality_issues: [{ chapter_index: 1, dimension: '??', severity: '?', message: '?????' }],
    manual_review_recommendations: ['? 1 ??????????'],
    completed_chapters: [
      {
        chapter_index: 1,
        model_run_id: 11,
        judge_report_id: 12,
        repair_patch_id: 13,
        approved_scene_id: 14,
        memory_extract_id: 15,
      },
      {
        chapter_index: 2,
        model_run_id: 21,
        judge_report_id: 22,
        repair_patch_id: null,
        approved_scene_id: 24,
        memory_extract_id: 25,
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
  assert.ok(html.includes('????'));
  assert.ok(html.includes('?????'));
  assert.ok(html.includes('89'));
  assert.ok(html.includes('?? 1?91'));
  assert.ok(html.includes('?????'));
  assert.ok(html.includes('? 1 ??????????'));
});
