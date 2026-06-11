import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BookRunAuditPanel } from '../app/book-runs/audit';

const bookRun = {
  id: 12,
  workspace_id: 3,
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
    skill_chain: {
      schema_version: 'bookrun_skill_projection.v2',
      book_run_id: 12,
      status: 'completed',
      summary: {
        event_count: 4,
        recorded_event_count: 0,
        reconstructed_event_count: 4,
        evidence_basis: 'reconstructed',
        completed_chapter_count: 1,
        budget: { tokens_used: 120 },
      },
      events: [
        {
          event_name: 'skill.post',
          skill_name: 'generate',
          skill_version: '1.0.0',
          stage: 'chapter',
          status: 'generated',
          provenance: 'reconstructed_from_progress',
          recorded: false,
          input_refs: { compiled_context_id: 'ctx-1' },
          output_refs: { model_run_id: 11, draft_hash: 'sha256:draft' },
          metadata: { budget: { tokens_used: 120 } },
          prompt: '不应进入 Web 审计页的完整提示词。',
        },
        {
          event_name: 'skill.post',
          skill_name: 'judge',
          skill_version: '1.0.0',
          stage: 'chapter',
          status: 'pass',
          provenance: 'reconstructed_from_progress',
          recorded: false,
          output_refs: { judge_report_id: 12 },
          final_draft: '不应进入 Web 审计页的完整正文。',
        },
        {
          event_name: 'skill.post',
          skill_name: 'approve',
          skill_version: '1.0.0',
          stage: 'chapter',
          status: 'approved',
          provenance: 'reconstructed_from_progress',
          recorded: false,
          output_refs: { approved_scene_id: 14 },
        },
        {
          event_name: 'skill.post',
          skill_name: 'export',
          skill_version: '1.0.0',
          stage: 'book',
          status: 'completed',
          provenance: 'reconstructed_from_progress',
          recorded: false,
          input_refs: { book_run_id: 12 },
          output_refs: { book_artifact_ref: 'book_run:12:export' },
        },
      ],
    },
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
  assert.ok(html.includes('\u8bc1\u636e\u6765\u6e90'));
  assert.ok(html.includes('?????'));
  assert.ok(html.includes('89'));
  assert.ok(html.includes('?? 1?91'));
  assert.ok(html.includes('?????'));
  assert.ok(html.includes('? 1 ??????????'));
  assert.ok(html.includes('技能链审计'));
  assert.ok(html.includes('bookrun_skill_projection.v2'));
  assert.ok(html.includes('事件数'));
  assert.ok(html.includes('4'));
  assert.ok(html.includes('\u8bc1\u636e\u6765\u6e90'));
  assert.ok(html.includes('reconstructed'));
  assert.ok(html.includes('\u91cd\u5efa'));
  assert.ok(html.includes('provenance=reconstructed_from_progress'));
  assert.ok(html.includes('generate'));
  assert.ok(html.includes('judge'));
  assert.ok(html.includes('approve'));
  assert.ok(html.includes('export'));
  assert.ok(html.includes('stage=chapter'));
  assert.ok(html.includes('status=generated'));
  assert.ok(html.includes('compiled_context_id=ctx-1'));
  assert.ok(html.includes('model_run_id=11'));
  assert.ok(html.includes('judge_report_id=12'));
  assert.ok(html.includes('book_artifact_ref=book_run:12:export'));
  assert.ok(!html.includes('不应进入 Web 审计页的完整提示词。'));
  assert.ok(!html.includes('不应进入 Web 审计页的完整正文。'));
});

test('BookRun 审计面板优先展示 skill_chain 技能链', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookRunAuditPanel, {
      bookRun: {
        ...bookRun,
        skill_chain: {
          skill_chain_version: 'bookrun-default-v1',
          chapters: [
            {
              chapter_index: 1,
              skills: [
                { skill_name: 'generate', status: 'generated', model_run_id: 31 },
                { skill_name: 'judge', status: 'pass', judge_report_id: 41 },
                { skill_name: 'approve', status: 'approved', approved_scene_id: 51 },
              ],
            },
          ],
        },
      },
    }),
  );

  assert.ok(html.includes('技能链'));
  assert.ok(html.includes('generate'));
  assert.ok(html.includes('judge'));
  assert.ok(html.includes('approve'));
  assert.ok(html.includes('model_run_id=31'));
  assert.ok(html.includes('judge_report_id=41'));
});

test('BookRun 审计面板缺少 skill_chain 时显示空状态', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookRunAuditPanel, {
      bookRun: { ...bookRun, progress: { completed_chapters: [] } },
    }),
  );

  assert.ok(html.includes('暂无技能链审计数据'));
});
