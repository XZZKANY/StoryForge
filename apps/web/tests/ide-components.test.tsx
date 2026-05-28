import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChapterEditor } from '../components/ide/editors/ChapterEditor';
import { createJudgeIssueDecorations } from '../components/ide/editors/extensions/judgeIssueDecorations';
import { ProblemsPanel } from '../components/ide/panels/ProblemsPanel';
import { IdeShell } from '../components/ide/shell/IdeShell';
import { DiffViewer } from '../components/ide/views/DiffViewer';
import { ContextInspector } from '../components/ide/views/ContextInspector';
import { StoryMemoryExplorer } from '../components/ide/views/StoryMemoryExplorer';
import { BookRunPanel } from '../components/ide/views/BookRunPanel';

test('IdeShell 渲染 VS Code 式基础区域', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, { initialState: { workspace: 'default' } }),
  );

  assert.ok(html.includes('data-testid="ide-shell"'));
  assert.ok(html.includes('StoryForge IDE'));
  for (const label of ['Activity Bar', 'Explorer', 'Editor Area', 'Right Dock', 'Bottom Panel']) {
    assert.ok(html.includes(label), `缺少 ${label}`);
  }
});

test('ProblemsPanel 渲染空状态和诊断列表', () => {
  const emptyHtml = renderToStaticMarkup(React.createElement(ProblemsPanel, { diagnostics: [] }));
  assert.ok(emptyHtml.includes('当前没有诊断问题'));

  const listHtml = renderToStaticMarkup(
    React.createElement(ProblemsPanel, {
      diagnostics: [
        {
          id: 'judge:1',
          severity: 'error',
          code: 'setting_conflict',
          message: '设定冲突',
          range: { start: 0, end: 2 },
          source: 'judge',
          quickFixes: [{ command_id: 'judge.repair', title: '生成定向修复', args: {} }],
        },
      ],
    }),
  );
  assert.ok(listHtml.includes('setting_conflict'));
  assert.ok(listHtml.includes('设定冲突'));
  assert.ok(listHtml.includes('生成定向修复'));
});

test('DiffViewer 渲染修复前后两栏', () => {
  const html = renderToStaticMarkup(
    React.createElement(DiffViewer, { before: '旧文本', after: '新文本' }),
  );

  assert.ok(html.includes('修复前'));
  assert.ok(html.includes('修复后'));
  assert.ok(html.includes('旧文本'));
  assert.ok(html.includes('新文本'));
});

test('ChapterEditor 使用 CodeMirror 容器并保留诊断装饰输入', () => {
  const html = renderToStaticMarkup(
    React.createElement(ChapterEditor, {
      content: '# 第一章',
      diagnostics: [
        {
          id: 'judge:2',
          severity: 'warning',
          code: 'style_drift',
          message: '文风偏移',
          range: { start: 0, end: 4 },
          source: 'judge',
        },
      ],
      onChange: () => undefined,
    }),
  );

  assert.ok(html.includes('data-testid="chapter-editor"'));
  assert.ok(html.includes('data-editor-engine="codemirror6"'));
  assert.ok(html.includes('1'));
  assert.ok(html.includes('text-xs text-stone-400'));
});

test('createJudgeIssueDecorations 输出 CodeMirror 装饰范围和严重级别类名', () => {
  const decorations = createJudgeIssueDecorations([
    {
      id: 'judge:3',
      severity: 'error',
      code: 'setting_conflict',
      message: '设定冲突',
      range: { start: 2, end: 8 },
      source: 'judge',
    },
  ]);

  assert.deepEqual(decorations, [
    {
      from: 2,
      to: 8,
      className: 'ide-diagnostic-error',
      diagnosticId: 'judge:3',
    },
  ]);
});

test('ContextInspector ????????????????????', () => {
  const html = renderToStaticMarkup(
    React.createElement(ContextInspector, {
      snapshot: {
        compiled_context_id: 'ctx_unit',
        book_id: 1,
        chapter_id: 2,
        scene_id: 3,
        budget: { token_budget: 100, used_tokens: 60, dropped_tokens: 20, truncated: true },
        injected_blocks: [
          {
            block_id: 'memory',
            kind: 'memory_atom',
            source_ref: 'memory:1',
            token_count: 30,
            priority: 'high',
            reason: '?????????????',
            order: 1,
          },
        ],
        dropped_blocks: [
          {
            block_id: 'style',
            kind: 'style_rule',
            source_ref: 'style:1',
            token_count: 20,
            priority: 'low',
            reason: '???? token ??????????',
          },
        ],
        debug_summary: ['??? 1 ???????? 60/100 tokens?'],
      },
    }),
  );

  assert.ok(html.includes('Context Inspector'));
  assert.ok(html.includes('ctx_unit'));
  assert.ok(html.includes('60/100 tokens'));
  assert.ok(html.includes('??? 1'));
  assert.ok(html.includes('??? 1'));
  assert.ok(html.includes('memory:1'));
  assert.ok(html.includes('style:1'));
  assert.ok(html.includes('???? token ??'));
  assert.ok(html.includes('??? 1 ?????'));
});

test('ContextInspector ??????? evicted ??', () => {
  const html = renderToStaticMarkup(
    React.createElement(ContextInspector, { evictedAt: '2026-05-28T04:40:00+08:00' }),
  );

  assert.ok(html.includes('snapshot evicted at 2026-05-28T04:40:00+08:00'));
});

test('StoryMemoryExplorer ????????????????', () => {
  const html = renderToStaticMarkup(
    React.createElement(StoryMemoryExplorer, {
      result: {
        filters: {
          book_id: 1,
          entity_type: 'character',
          entity_id: 'linlan',
          fact_type: 'status',
          chapter: 5,
          conflict_status: 'conflicted',
        },
        total: 1,
        conflicted_count: 1,
        items: [
          {
            memory_id: 'memory:1',
            entity_type: 'character',
            entity_id: 'linlan',
            fact_type: 'status',
            value: '?????',
            source_ref: 'chapter:4',
            valid_from_chapter: 4,
            valid_to_chapter: null,
            confidence: 0.91,
            immutable: true,
            revision: 1,
            conflict_ids: ['conflict_1'],
          },
        ],
        conflict_queue: [
          {
            conflict_id: 'conflict_1',
            entity_id: 'linlan',
            fact_type: 'status',
            left_memory_id: 'memory:1',
            right_memory_id: 'memory:2',
            severity: 'blocking',
            reason: '????????????????????????',
            source_refs: ['chapter:4', 'agent:proposal'],
          },
        ],
      },
    }),
  );

  assert.ok(html.includes('Story Memory Explorer'));
  assert.ok(html.includes('book=1'));
  assert.ok(html.includes('entity=linlan'));
  assert.ok(html.includes('fact_type=status'));
  assert.ok(html.includes('chapter=5'));
  assert.ok(html.includes('?????'));
  assert.ok(html.includes('memory:1'));
  assert.ok(html.includes('????'));
  assert.ok(html.includes('blocking'));
  assert.ok(html.includes('conflict_1'));
});

test('StoryMemoryExplorer ?????', () => {
  const html = renderToStaticMarkup(React.createElement(StoryMemoryExplorer));

  assert.ok(html.includes('Story Memory Explorer'));
  assert.ok(html.includes('0'));
  assert.ok(html.includes('conflict=all'));
});

test('ActivityBar ? SidePanel ?? Story Memory ??', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, { initialState: { workspace: 'default', leftPanel: 'memory' } }),
  );

  assert.ok(html.includes('Story Memory'));
  assert.ok(html.includes('Story Memory Explorer'));
});

test('BookRunPanel ?????checkpoint?????????????', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookRunPanel, {
      run: {
        id: 12,
        status: 'awaiting_review',
        current_chapter_index: 3,
        total_chapters: 5,
        token_budget: 1000,
        tokens_used: 840,
        elapsed_time_sec: 61,
        time_budget_sec: 300,
        estimated_cost: 0.42,
        checkpoint: [
          { chapter_index: 2, model_run_id: 21, judge_report_id: 22, approved_scene_id: 23 },
        ],
        blocked_chapter: { chapter_index: 3, judge_report_id: 31, repair_patch_id: 32 },
        provider_fallback: { from: 'primary', to: 'backup', reason: 'rate_limit' },
      },
    }),
  );

  assert.ok(html.includes('BookRun Run Panel'));
  assert.ok(html.includes('BookRun #12'));
  assert.ok(html.includes('awaiting_review'));
  assert.ok(html.includes('3 / 5'));
  assert.ok(html.includes('840 / 1000'));
  assert.ok(html.includes('tokens remaining 160'));
  assert.ok(html.includes('checkpoint'));
  assert.ok(html.includes('model_run_id=21'));
  assert.ok(html.includes('blocked chapter 3'));
  assert.ok(html.includes('repair_patch_id=32'));
  assert.ok(html.includes('provider fallback'));
  for (const label of ['Start', 'Pause', 'Resume', 'Stop', 'Retry from checkpoint', 'Open audit']) {
    assert.ok(html.includes(label), `?? ${label}`);
  }
});

test('BookRunPanel ?????', () => {
  const html = renderToStaticMarkup(React.createElement(BookRunPanel));

  assert.ok(html.includes('当前没有选中的 BookRun'));
});

test('BottomPanel runs ???? BookRunPanel', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, { initialState: { bottomPanel: 'runs' } }),
  );

  assert.ok(html.includes('BookRun Run Panel'));
});
