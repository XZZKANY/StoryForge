import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  mapAssistantToolCallsToAssistantToolNodes,
  mapBookRunToAssistantToolNodes,
} from '../components/home/assistant-tool-node-mapper';

const baseBookRun = {
  id: 12,
  book_id: 5,
  blueprint_id: 9,
  status: 'running',
  current_chapter_index: 2,
  total_chapters: 5,
  progress: { completed_chapters: [{ chapter_index: 1 }] },
  checkpoint: [{ chapter_index: 1 }],
  token_budget: 12000,
  tokens_used: 3200,
  time_budget_sec: 900,
  elapsed_time_sec: 180,
  chapter_budget: 5,
  estimated_cost: 1.25,
  cost_summary: { tokens_remaining: 8800, estimated_cost: 1.25 },
} as const;

test('mapBookRunToAssistantToolNodes 将 running BookRun 映射为真实运行节点', () => {
  const nodes = mapBookRunToAssistantToolNodes(baseBookRun);

  assert.equal(nodes[0].tool, 'Provider.resolve');
  assert.equal(nodes[0].status, 'completed');
  assert.equal(nodes[1].tool, 'Blueprint.create');
  assert.equal(nodes[1].status, 'completed');
  const chapterNode = nodes.find((node) => node.tool === 'Chapter.generate');
  assert.equal(chapterNode?.status, 'running');
  assert.match(chapterNode?.summary ?? '', /第 2\/5 章/);
  assert.equal(chapterNode?.tokenLabel, '3200 / 12000 tokens');
  assert.match(chapterNode?.toolUseLabel ?? '', /时间 180\/900s/);
  assert.match(chapterNode?.toolUseLabel ?? '', /章节 2\/5/);
  assert.match(chapterNode?.toolUseLabel ?? '', /成本 1.25/);
});

test('mapBookRunToAssistantToolNodes 在 Provider 不可用时不伪装运行', () => {
  const nodes = mapBookRunToAssistantToolNodes({
    ...baseBookRun,
    progress: {
      provider_resolution: {
        ok: false,
        unavailable_reason: '缺少服务端 Provider 凭据',
      },
    },
  });

  const providerNode = nodes.find((node) => node.tool === 'Provider.resolve');
  const chapterNode = nodes.find((node) => node.tool === 'Chapter.generate');
  assert.equal(providerNode?.status, 'failed');
  assert.match(providerNode?.summary ?? '', /缺少服务端 Provider 凭据/);
  assert.notEqual(chapterNode?.status, 'running');
  assert.match(chapterNode?.summary ?? '', /Provider 不可用/);
});

test('mapBookRunToAssistantToolNodes 在 Provider 不可用时不伪装完成', () => {
  const nodes = mapBookRunToAssistantToolNodes({
    ...baseBookRun,
    status: 'completed',
    current_chapter_index: 5,
    progress: {
      provider_resolution: {
        ok: false,
        unavailable_reason: '服务端 Provider 缺少有效模型配置',
      },
      completed_chapters: [1, 2, 3, 4, 5].map((chapter_index) => ({ chapter_index })),
    },
  });

  const providerNode = nodes.find((node) => node.tool === 'Provider.resolve');
  const chapterNode = nodes.find((node) => node.tool === 'Chapter.generate');
  assert.equal(providerNode?.status, 'failed');
  assert.equal(chapterNode?.status, 'failed');
  assert.notEqual(chapterNode?.status, 'completed');
  assert.notEqual(chapterNode?.status, 'running');
  assert.match(chapterNode?.summary ?? '', /Provider 不可用/);
});

test('mapBookRunToAssistantToolNodes 在未设置预算上限时展示已用量', () => {
  const nodes = mapBookRunToAssistantToolNodes({
    ...baseBookRun,
    token_budget: null,
    time_budget_sec: null,
    chapter_budget: null,
  });

  const chapterNode = nodes.find((node) => node.tool === 'Chapter.generate');
  assert.equal(chapterNode?.tokenLabel, '3200 tokens');
  assert.match(chapterNode?.toolUseLabel ?? '', /时间 180s/);
  assert.match(chapterNode?.toolUseLabel ?? '', /章节 2\/5/);
  assert.match(chapterNode?.toolUseLabel ?? '', /成本 1.25/);
});

test('mapBookRunToAssistantToolNodes 将 awaiting_review 映射为需要批准', () => {
  const nodes = mapBookRunToAssistantToolNodes({
    ...baseBookRun,
    status: 'awaiting_review',
    progress: {
      completed_chapters: [{ chapter_index: 1 }],
      blocked_chapter: { chapter_index: 2, judge_report_id: 20, repair_patch_id: 21 },
    },
  });

  assert.equal(nodes.find((node) => node.tool === 'Judge.review')?.status, 'needs_approval');
  assert.equal(nodes.find((node) => node.tool === 'Repair.suggest')?.status, 'needs_approval');
});

test('mapBookRunToAssistantToolNodes 将 completed BookRun 映射为导出等待节点', () => {
  const nodes = mapBookRunToAssistantToolNodes({
    ...baseBookRun,
    status: 'completed',
    current_chapter_index: 5,
    progress: { completed_chapters: [1, 2, 3, 4, 5].map((chapter_index) => ({ chapter_index })) },
  });

  assert.equal(nodes.find((node) => node.tool === 'Chapter.generate')?.status, 'completed');
  assert.equal(nodes.find((node) => node.tool === 'Artifact.export')?.status, 'waiting');
});

test('mapBookRunToAssistantToolNodes 在 BookRun 未完成时说明导出入口等待原因', () => {
  const nodes = mapBookRunToAssistantToolNodes(baseBookRun);

  const exportNode = nodes.find((node) => node.tool === 'Artifact.export');
  assert.equal(exportNode?.status, 'waiting');
  assert.match(exportNode?.summary ?? '', /等待 BookRun 完成后生成导出入口/);
});

test('mapBookRunToAssistantToolNodes 根据 audit_report 证据映射导出完成', () => {
  const nodes = mapBookRunToAssistantToolNodes({
    ...baseBookRun,
    status: 'completed',
    current_chapter_index: 5,
    progress: {
      completed_chapters: [1, 2, 3, 4, 5].map((chapter_index) => ({ chapter_index })),
      audit_report: {
        artifact_id: 88,
        name: 'audit_report.json',
        skill_chain: { schema_version: 'bookrun_skill_projection.v2' },
      },
    },
  });

  const exportNode = nodes.find((node) => node.tool === 'Artifact.export');
  assert.equal(exportNode?.status, 'completed');
  assert.match(exportNode?.summary ?? '', /audit_report\.json/);
  assert.match(exportNode?.summary ?? '', /Artifact #88/);
});

test('mapBookRunToAssistantToolNodes 将 paused 和 failed 状态展示为失败原因', () => {
  const nodes = mapBookRunToAssistantToolNodes({
    ...baseBookRun,
    status: 'paused_by_budget',
    progress: { pause_reason: '预算触顶', completed_chapters: [{ chapter_index: 1 }] },
  });

  const chapterNode = nodes.find((node) => node.tool === 'Chapter.generate');
  assert.equal(chapterNode?.status, 'failed');
  assert.match(chapterNode?.summary ?? '', /预算触顶/);
});

test('mapBookRunToAssistantToolNodes 对预算暂停缺少原因时使用兜底文案', () => {
  const nodes = mapBookRunToAssistantToolNodes({
    ...baseBookRun,
    status: 'paused_by_budget',
    progress: { completed_chapters: [{ chapter_index: 1 }] },
  });

  const chapterNode = nodes.find((node) => node.tool === 'Chapter.generate');
  assert.equal(chapterNode?.status, 'failed');
  assert.match(chapterNode?.summary ?? '', /预算触顶/);
});

test('mapAssistantToolCallsToAssistantToolNodes 优先使用 tool call 事实源', () => {
  const nodes = mapAssistantToolCallsToAssistantToolNodes([
    {
      id: 7,
      session_id: 31,
      tool_name: 'book_run.pause',
      status: 'completed',
      input_summary: { summary: '暂停 BookRun #12' },
      output_summary: { summary: 'BookRun #12 已暂停。' },
      error_message: null,
      related_type: 'book_run',
      related_id: 12,
      started_at: null,
      finished_at: '2026-06-09T21:30:00',
      created_at: '2026-06-09T21:29:00',
      updated_at: '2026-06-09T21:30:00',
    },
    {
      id: 8,
      session_id: 31,
      tool_name: 'chapter.review',
      status: 'needs_approval',
      input_summary: { summary: '审阅第二章' },
      output_summary: {},
      error_message: null,
      related_type: 'scene_packet',
      related_id: 42,
      started_at: null,
      finished_at: null,
      created_at: '2026-06-09T21:31:00',
      updated_at: '2026-06-09T21:31:00',
    },
    {
      id: 9,
      session_id: 31,
      tool_name: 'artifact.export',
      status: 'failed',
      input_summary: {},
      output_summary: {},
      error_message: '导出接口返回 500',
      related_type: 'book_run',
      related_id: 12,
      started_at: null,
      finished_at: null,
      created_at: '2026-06-09T21:32:00',
      updated_at: '2026-06-09T21:32:00',
    },
  ]);

  assert.deepEqual(
    nodes.map((node) => [node.id, node.tool, node.status, node.summary]),
    [
      ['assistant-tool-call-7', 'book_run.pause', 'completed', 'BookRun #12 已暂停。'],
      ['assistant-tool-call-8', 'chapter.review', 'needs_approval', '审阅第二章'],
      ['assistant-tool-call-9', 'artifact.export', 'failed', '导出接口返回 500'],
    ],
  );
  assert.equal(nodes[0].label, 'book_run.pause');
});

test('mapAssistantToolCallsToAssistantToolNodes 将 planned 和 paused 映射为等待', () => {
  const nodes = mapAssistantToolCallsToAssistantToolNodes([
    {
      id: 10,
      session_id: 31,
      tool_name: 'book_run.retry',
      status: 'planned',
      input_summary: {},
      output_summary: {},
      error_message: null,
      related_type: null,
      related_id: null,
      started_at: null,
      finished_at: null,
      created_at: '2026-06-09T21:33:00',
      updated_at: '2026-06-09T21:33:00',
    },
    {
      id: 11,
      session_id: 31,
      tool_name: 'book_run.stop',
      status: 'paused',
      input_summary: {},
      output_summary: {},
      error_message: null,
      related_type: null,
      related_id: null,
      started_at: null,
      finished_at: null,
      created_at: '2026-06-09T21:34:00',
      updated_at: '2026-06-09T21:34:00',
    },
  ]);

  assert.deepEqual(
    nodes.map((node) => node.status),
    ['waiting', 'waiting'],
  );
});
