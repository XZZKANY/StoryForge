import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChapterEditor } from '../components/ide/editors/ChapterEditor';
import { createJudgeIssueDecorations } from '../components/ide/editors/extensions/judgeIssueDecorations';
import { ProblemsPanel } from '../components/ide/panels/ProblemsPanel';
import { EditorArea } from '../components/ide/shell/EditorArea';
import { IdeShell } from '../components/ide/shell/IdeShell';
import { ArtifactViewer } from '../components/ide/views/ArtifactViewer';
import { DiffViewer } from '../components/ide/views/DiffViewer';
import { ContextInspector } from '../components/ide/views/ContextInspector';
import { StoryMemoryExplorer } from '../components/ide/views/StoryMemoryExplorer';
import { BookRunPanel, resolveBookRunCommandState } from '../components/ide/views/BookRunPanel';
import { BookRunEventsPanel } from '../components/ide/views/BookRunEventsPanel';
import { reduceBookRunEventSourceState } from '../components/ide/views/BookRunEventsClient';
import {
  JudgeRepairWorkbench,
  buildJudgeRepairCommandArgs,
  resolveJudgeApprovalResult,
  resolveJudgeRepairResult,
} from '../components/ide/workflows/JudgeRepairWorkbench';

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
  assert.ok(listHtml.includes('data-diagnostic-id="judge:1"'));
  assert.ok(listHtml.includes('data-range-start="0"'));
  assert.ok(listHtml.includes('data-range-end="2"'));
  assert.ok(listHtml.includes('data-command-id="judge.repair"'));
  assert.ok(listHtml.includes('data-total-diagnostics="1"'));
  assert.ok(listHtml.includes('data-rendered-diagnostics="1"'));
});

test('DiffViewer 渲染修复前后两栏和批准命令', () => {
  const html = renderToStaticMarkup(
    React.createElement(DiffViewer, {
      before: '旧文本',
      after: '新文本',
      approveCommandId: 'judge.approve',
      approveArgs: { repair_patch_id: 32 },
      auditEventId: 'ide-command:judge.approve:unit',
    }),
  );

  assert.ok(html.includes('修复前'));
  assert.ok(html.includes('修复后'));
  assert.ok(html.includes('旧文本'));
  assert.ok(html.includes('新文本'));
  assert.ok(html.includes('批准写回'));
  assert.ok(html.includes('data-command-id="judge.approve"'));
  assert.ok(html.includes('data-command-args="{&quot;repair_patch_id&quot;:32}"'));
  assert.ok(html.includes('ide-command:judge.approve:unit'));
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

test('EditorArea 在 IDE 内提供旧 5 页 legacy 子视图', () => {
  const legacyTabs = [
    ['legacy:studio', 'Studio 创作工作台', '/studio'],
    ['legacy:retrieval', 'Retrieval 证据检索', '/retrieval'],
    ['legacy:runs', 'Runs 运行诊断', '/runs'],
    ['legacy:artifacts', 'Artifacts 工件与导出', '/artifacts'],
    ['legacy:evaluations', 'Evaluations 评测系统', '/evaluations'],
  ] as const;

  for (const [tabId, title, href] of legacyTabs) {
    const html = renderToStaticMarkup(
      React.createElement(EditorArea, { tabs: [tabId], activeTabId: tabId }),
    );

    assert.ok(html.includes(`data-legacy-view="${tabId}"`), `${tabId} 应在 IDE 内渲染`);
    assert.ok(html.includes(title), `${tabId} 应显示旧页面标题`);
    assert.ok(html.includes(`href="${href}"`), `${tabId} 应保留旧路由兼容链接`);
    assert.ok(html.includes('在 IDE 内访问'), `${tabId} 应声明旧页面已在 IDE 内访问`);
  }
});
test('ContextInspector 渲染注入块、裁剪块和调试摘要', () => {
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
            reason: '命中角色当前位置',
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
            reason: '超过 token 预算被裁剪',
          },
        ],
        debug_summary: ['注入 1 个记忆块，使用 60/100 tokens。'],
      },
    }),
  );

  assert.ok(html.includes('Context Inspector'));
  assert.ok(html.includes('ctx_unit'));
  assert.ok(html.includes('60/100 tokens'));
  assert.ok(html.includes('注入块 1'));
  assert.ok(html.includes('裁剪块 1'));
  assert.ok(html.includes('memory:1'));
  assert.ok(html.includes('style:1'));
  assert.ok(html.includes('超过 token 预算'));
  assert.ok(html.includes('注入 1 个记忆块'));
});

test('ContextInspector 渲染快照被清理提示', () => {
  const html = renderToStaticMarkup(
    React.createElement(ContextInspector, { evictedAt: '2026-05-28T04:40:00+08:00' }),
  );

  assert.ok(html.includes('snapshot evicted at 2026-05-28T04:40:00+08:00'));
});

test('ContextInspector 暴露 ModelRun、Repair 和 Approve 入口', () => {
  const html = renderToStaticMarkup(
    React.createElement(ContextInspector, {
      snapshot: {
        compiled_context_id: 'ctx_unit',
        book_id: 1,
        chapter_id: 2,
        scene_id: 3,
        budget: { token_budget: 100, used_tokens: 60, dropped_tokens: 20, truncated: true },
        injected_blocks: [],
        dropped_blocks: [],
        debug_summary: [],
      },
      entries: [
        { kind: 'model_run', label: 'ModelRun #101', href: '/ide?inspector=ctx_unit' },
        { kind: 'repair', label: 'Repair Patch #32', href: '/ide?inspector=ctx_unit' },
        { kind: 'approve', label: 'Approve #303', href: '/ide?inspector=ctx_unit' },
      ],
    }),
  );

  for (const kind of ['model_run', 'repair', 'approve'] as const) {
    assert.ok(html.includes(`data-context-entry-kind="${kind}"`), `缺少 ${kind} 入口`);
    assert.ok(html.includes('data-compiled-context-id="ctx_unit"'));
  }
  assert.ok(html.includes('href="/ide?inspector=ctx_unit"'));
  assert.ok(html.includes('data-context-entry-href="/ide?inspector=ctx_unit"'));
});

test('IdeShell 根据 inspector URL 状态渲染 Context Inspector 快照', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, {
      initialState: {
        tabs: ['legacy:studio'],
        activeTabId: 'legacy:studio',
        inspectorId: 'ctx_unit',
        contextSnapshot: {
          compiled_context_id: 'ctx_unit',
          book_id: 1,
          chapter_id: 2,
          scene_id: 3,
          budget: { token_budget: 100, used_tokens: 64, dropped_tokens: 12, truncated: false },
          injected_blocks: [],
          dropped_blocks: [],
          debug_summary: ['从 inspector URL 加载真实快照。'],
        },
      },
    }),
  );

  assert.ok(html.includes('data-active-inspector-id="ctx_unit"'));
  assert.ok(html.includes('Context Inspector'));
  assert.ok(html.includes('64/100 tokens'));
  assert.ok(html.includes('从 inspector URL 加载真实快照'));
});

test('EditorArea 对 inspector 快照缺失显示 evicted 提示', () => {
  const html = renderToStaticMarkup(
    React.createElement(EditorArea, {
      tabs: ['legacy:studio'],
      activeTabId: 'legacy:studio',
      inspectorId: 'ctx_missing',
      contextSnapshotEvictedAt: 'unknown',
    }),
  );

  assert.ok(html.includes('data-active-inspector-id="ctx_missing"'));
  assert.ok(html.includes('snapshot evicted at unknown'));
});

test('StoryMemoryExplorer 渲染过滤条件、记忆条目和冲突队列', () => {
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
            value: '林岚受伤',
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
            reason: '角色状态与新章节提案冲突',
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
  assert.ok(html.includes('林岚受伤'));
  assert.ok(html.includes('memory:1'));
  assert.ok(html.includes('不可变'));
  assert.ok(html.includes('blocking'));
  assert.ok(html.includes('conflict_1'));
  assert.ok(html.includes('data-command-id="memory.resolve_conflict"'));
  assert.ok(html.includes('data-command-args="{&quot;conflict_id&quot;:&quot;conflict_1&quot;'));
  assert.ok(html.includes('&quot;left_memory_id&quot;:&quot;memory:1&quot;'));
  assert.ok(html.includes('&quot;right_memory_id&quot;:&quot;memory:2&quot;'));
  assert.ok(html.includes('&quot;resolution&quot;:&quot;keep_left&quot;'));
  assert.ok(html.includes('&quot;winner_memory_id&quot;:&quot;memory:1&quot;'));
  assert.ok(
    html.includes('&quot;source_refs&quot;:[&quot;chapter:4&quot;,&quot;agent:proposal&quot;]'),
  );
});

test('StoryMemoryExplorer 渲染空状态', () => {
  const html = renderToStaticMarkup(React.createElement(StoryMemoryExplorer));

  assert.ok(html.includes('Story Memory Explorer'));
  assert.ok(html.includes('0'));
  assert.ok(html.includes('conflict=all'));
});

test('ActivityBar 与 SidePanel 显示 Story Memory 面板', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, { initialState: { workspace: 'default', leftPanel: 'memory' } }),
  );

  assert.ok(html.includes('Story Memory'));
  assert.ok(html.includes('Story Memory Explorer'));
});

test('ArtifactViewer 暴露 trace 反向追溯机器可读属性', () => {
  const html = renderToStaticMarkup(
    React.createElement(ArtifactViewer, {
      preview: {
        artifact: {
          id: 7,
          artifact_type: 'scene',
          lineage_key: 'scene:303',
          name: '第三幕',
          status: 'ready',
          storage_uri: 'memory://artifact/7',
          mime_type: 'text/markdown',
          size_bytes: 128,
          version: 2,
        },
        preview: { format: 'markdown', content_preview: '正文', summary: { words: 2 } },
        download: {
          download_mode: 'inline',
          mime_type: 'text/markdown',
          storage_uri: 'memory://artifact/7',
          content_preview: '正文',
          payload_summary: {},
        },
        versions: [
          { id: 7, version: 2, name: '第三幕', status: 'ready', created_at: '2026-05-28' },
        ],
        trace: {
          book_run: { id: 42, label: 'BookRun', href: '/ide?panel.bottom=runs&book_run=42' },
          model_run: {
            id: 101,
            label: 'ModelRun',
            href: '/ide?panel.bottom=runs&model_run=101',
            context_href: '/ide?inspector=ctx_trace',
          },
          judge_report: {
            id: 202,
            label: 'JudgeReport',
            href: '/ide?panel.bottom=problems&judge_report=202',
            context_href: '/ide?inspector=ctx_trace',
          },
          approve: {
            id: 303,
            label: 'Approve',
            href: '/ide?tab=scene:303',
            context_href: '/ide?inspector=ctx_trace',
          },
        },
      },
    }),
  );

  for (const [kind, id] of [
    ['book_run', 42],
    ['model_run', 101],
    ['judge_report', 202],
    ['approve', 303],
  ] as const) {
    assert.ok(html.includes(`data-trace-kind="${kind}"`), `缺少 trace kind ${kind}`);
    assert.ok(html.includes(`data-trace-id="${id}"`), `缺少 trace id ${id}`);
  }
  assert.ok(html.includes('data-trace-href="/ide?tab=scene:303"'));
  assert.ok(html.includes('data-context-href="/ide?inspector=ctx_trace"'));
  assert.ok(html.includes('href="/ide?inspector=ctx_trace"'));
  assert.ok(html.includes('上下文'));
});

test('BookRunPanel 渲染运行状态、checkpoint 和命令按钮', () => {
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
  assert.ok(html.includes('data-checkpoint-index="2"'));
  assert.ok(html.includes('data-checkpoint-href="/ide?tab=chapter:2"'));
  assert.ok(html.includes('href="/ide?tab=chapter:2"'));
  assert.ok(html.includes('href="/ide?panel.bottom=runs&amp;model_run=21"'));
  assert.ok(html.includes('href="/ide?panel.bottom=problems&amp;judge_report=22"'));
  assert.ok(html.includes('href="/ide?tab=scene:23"'));
  assert.ok(html.includes('data-blocked-chapter-index="3"'));
  assert.ok(html.includes('data-blocked-chapter-href="/ide?tab=chapter:3"'));
  assert.ok(html.includes('href="/ide?tab=chapter:3"'));
  assert.ok(!html.includes('disabled=""'));
  for (const [label, commandId] of [
    ['Start', 'bookrun.start'],
    ['Pause', 'bookrun.pause'],
    ['Resume', 'bookrun.resume'],
    ['Stop', 'bookrun.stop'],
    ['Retry from checkpoint', 'bookrun.retry_from_checkpoint'],
    ['Open audit', 'audit.open'],
  ] as const) {
    assert.ok(html.includes(label), `缺少 ${label}`);
    assert.ok(html.includes(`data-command-id="${commandId}"`), `缺少 ${commandId}`);
  }
});

test('BookRunPanel 渲染命令响应审计追踪', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookRunPanel, {
      run: {
        id: 12,
        status: 'running',
        current_chapter_index: 1,
        total_chapters: 5,
        token_budget: null,
        tokens_used: 10,
        elapsed_time_sec: 3,
        time_budget_sec: null,
        estimated_cost: 0.01,
        checkpoint: [],
      },
      initialCommandResult: {
        command_id: 'bookrun.start',
        status: 'accepted',
        audit_event_id: 'ide-command:bookrun.start:unit',
        payload: {},
      },
    }),
  );

  assert.ok(html.includes('最近命令结果'));
  assert.ok(html.includes('bookrun.start'));
  assert.ok(html.includes('accepted'));
  assert.ok(html.includes('audit_event_id=ide-command:bookrun.start:unit'));
});

test('resolveBookRunCommandState 记录命令审计结果和错误', async () => {
  const calls: Array<{ commandId: string; args: Record<string, unknown> }> = [];
  const accepted = await resolveBookRunCommandState(
    'bookrun.start',
    { book_run_id: 12 },
    async (commandId, args) => {
      calls.push({ commandId, args });
      return {
        command_id: commandId,
        status: 'accepted',
        audit_event_id: 'ide-command:bookrun.start:unit',
        payload: { args },
      };
    },
  );

  assert.deepEqual(calls, [{ commandId: 'bookrun.start', args: { book_run_id: 12 } }]);
  assert.equal(accepted.result?.audit_event_id, 'ide-command:bookrun.start:unit');
  assert.equal(accepted.error, undefined);

  const failed = await resolveBookRunCommandState(
    'bookrun.pause',
    { book_run_id: 12 },
    async () => {
      throw new Error('网络超时');
    },
  );

  assert.equal(failed.result, undefined);
  assert.equal(failed.error, '网络超时');
});

test('BookRunPanel 渲染空状态', () => {
  const html = renderToStaticMarkup(React.createElement(BookRunPanel));

  assert.ok(html.includes('当前没有选中的 BookRun'));
});

test('BookRunEventsPanel 暴露 SSE 快照入口和事件摘要', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookRunEventsPanel, {
      run: {
        id: 12,
        status: 'completed',
        current_chapter_index: 5,
        total_chapters: 5,
        token_budget: 1000,
        tokens_used: 900,
        elapsed_time_sec: 120,
        time_budget_sec: 300,
        estimated_cost: 0.5,
        checkpoint: [
          { chapter_index: 5, model_run_id: 51, judge_report_id: 52, approved_scene_id: 53 },
        ],
      },
      events: [
        { event: 'progress', data: { book_run_id: 12, status: 'completed' } },
        { event: 'checkpoint', data: { latest_checkpoint: { chapter_index: 5 } } },
        { event: 'budget', data: { tokens_remaining: 100 } },
        { event: 'completed', data: { completed_count: 5 } },
      ],
    }),
  );

  assert.ok(html.includes('data-event-source="sse"'));
  assert.ok(html.includes('data-events-url="/api/book-runs/12/events"'));
  assert.ok(!html.includes('data-events-url="/api/ide/runs/12/events"'));
  assert.ok(html.includes('data-eventsource-client="book-run"'));
  assert.ok(html.includes('data-initial-event-count="4"'));
  assert.ok(html.includes('text/event-stream'));
  for (const eventName of ['progress', 'checkpoint', 'budget', 'completed']) {
    assert.ok(html.includes(`data-run-event="${eventName}"`), `缺少事件 ${eventName}`);
  }
  assert.ok(html.includes('tokens_remaining=100'));
  assert.ok(html.includes('data-command-id="bookrun.start"'));
});

test('BookRunEventsClient 重连状态机覆盖 error 后自动恢复 open', () => {
  const connecting = reduceBookRunEventSourceState(undefined, { type: 'connect' });
  assert.deepEqual(connecting, { connectionState: 'connecting', retryCount: 0 });
  const reconnecting = reduceBookRunEventSourceState(connecting, { type: 'error' });
  assert.deepEqual(reconnecting, { connectionState: 'reconnecting', retryCount: 1 });
  const reopened = reduceBookRunEventSourceState(reconnecting, { type: 'event' });
  assert.deepEqual(reopened, { connectionState: 'open', retryCount: 1 });
  const secondError = reduceBookRunEventSourceState(reopened, { type: 'error' });
  assert.deepEqual(secondError, { connectionState: 'reconnecting', retryCount: 2 });
  const closed = reduceBookRunEventSourceState(secondError, { type: 'close' });
  assert.deepEqual(closed, { connectionState: 'closed', retryCount: 2 });
});
test('BookRunEventsClient 使用浏览器 EventSource 长连接并暴露重连状态', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/ide/views/BookRunEventsClient.tsx'),
    'utf8',
  );

  assert.ok(source.includes("'use client'"), 'EventSource 客户端必须是浏览器组件');
  assert.ok(source.includes('new EventSource(eventsUrl)'), '客户端必须打开真实 EventSource 长连接');
  assert.ok(source.includes("addEventListener('error'"), '客户端必须监听错误事件以观察重连');
  assert.ok(source.includes('retryCount'), '客户端必须暴露重连计数');
  assert.ok(source.includes('MAX_LIVE_EVENTS'), '客户端必须限制长连接事件列表长度');
});
test('JudgeRepairWorkbench 串联诊断选择、修复 Diff 和批准审计链', () => {
  const html = renderToStaticMarkup(
    React.createElement(JudgeRepairWorkbench, {
      content: '林岚走向北岸灯塔。',
      diagnostics: [
        {
          id: 'judge:9',
          severity: 'error',
          code: 'setting_conflict',
          message: '北岸灯塔位置冲突',
          range: { start: 4, end: 8 },
          source: 'judge',
          quickFixes: [
            {
              command_id: 'judge.repair',
              title: '生成定向修复',
              args: { issue_id: 9, scene_id: 3 },
            },
          ],
        },
      ],
      selectedDiagnosticId: 'judge:9',
      judgeRunArgs: { scene_id: 3 },
      repairResult: {
        before: '林岚走向北岸灯塔。',
        after: '林岚走向南岸灯塔。',
        repair_patch_id: 32,
      },
      approvalResult: {
        audit_event_id: 'ide-command:judge.approve:unit',
      },
    }),
  );

  assert.ok(html.includes('data-testid="judge-repair-workbench"'));
  assert.ok(html.includes('data-selected-diagnostic-id="judge:9"'));
  assert.ok(html.includes('data-selected-range="4:8"'));
  assert.ok(html.includes('运行 Judge'));
  assert.ok(html.includes('data-command-id="judge.run"'));
  assert.ok(html.includes('data-command-args="{&quot;scene_id&quot;:3}"'));
  assert.ok(html.includes('data-command-id="judge.repair"'));
  assert.ok(html.includes('data-command-id="judge.approve"'));
  assert.ok(html.includes('林岚走向南岸灯塔。'));
  assert.ok(html.includes('ide-command:judge.approve:unit'));
});

test('JudgeRepairWorkbench 将后端修复命令响应接成可视 Diff', async () => {
  const message = '\u5317\u5cb8\u706f\u5854\u4f4d\u7f6e\u51b2\u7a81';
  const fixTitle = '\u751f\u6210\u5b9a\u5411\u4fee\u590d';
  const content = '\u6797\u5c9a\u8d70\u5411\u5317\u5cb8\u706f\u5854\u3002';
  const targetSpan = '\u5317\u5cb8\u706f\u5854';
  const replacementText = '\u5357\u5cb8\u706f\u5854';
  const after = '\u6797\u5c9a\u8d70\u5411\u5357\u5cb8\u706f\u5854\u3002';
  const writebackStatus = '\u5df2\u56de\u5199';
  const diagnostic = {
    id: 'judge:9',
    severity: 'error' as const,
    code: 'setting_conflict',
    message,
    range: { start: 4, end: 8 },
    source: 'judge' as const,
    quickFixes: [
      { command_id: 'judge.repair', title: fixTitle, args: { issue_id: 9, scene_id: 3 } },
    ],
  };

  assert.deepEqual(buildJudgeRepairCommandArgs(diagnostic, content), {
    issue_id: 9,
    scene_id: 3,
    content,
  });

  const repairResult = await resolveJudgeRepairResult(
    diagnostic,
    content,
    async (commandId, args) => {
      assert.equal(commandId, 'judge.repair');
      assert.deepEqual(args, { issue_id: 9, scene_id: 3, content });
      return {
        command_id: commandId,
        status: 'accepted',
        audit_event_id: 'ide-command:judge.repair:unit',
        payload: {
          patch: {
            id: 32,
            issue_id: 9,
            target_span: targetSpan,
            replacement_text: replacementText,
            requires_rejudge: true,
          },
        },
      };
    },
  );

  assert.deepEqual(repairResult, {
    before: content,
    after,
    repair_patch_id: 32,
    audit_event_id: 'ide-command:judge.repair:unit',
  });

  const approvalResult = await resolveJudgeApprovalResult(32, async (commandId, args) => {
    assert.equal(commandId, 'judge.approve');
    assert.deepEqual(args, { repair_patch_id: 32 });
    return {
      command_id: commandId,
      status: 'accepted',
      audit_event_id: 'ide-command:judge.approve:unit',
      payload: { approval: { writeback_status: writebackStatus } },
    };
  });

  assert.deepEqual(approvalResult, { audit_event_id: 'ide-command:judge.approve:unit' });
});

test('BottomPanel runs 面板嵌入 BookRunPanel 并复用命令系统', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, { initialState: { bottomPanel: 'runs' } }),
  );

  assert.ok(html.includes('BookRun Run Panel'));
  assert.ok(html.includes('data-command-id="bookrun.start"'));
  assert.ok(html.includes('/api/ide/commands'));
});

test('IdeShell 暴露 URL 同步所需的面板状态和分享链接', () => {
  const html = renderToStaticMarkup(
    React.createElement(IdeShell, {
      initialState: {
        workspace: 'default',
        bookId: 12,
        tabs: ['legacy:studio', 'chapter:5'],
        activeTabId: 'chapter:5',
        leftPanel: 'memory',
        bottomPanel: 'runs',
      },
    }),
  );

  assert.ok(html.includes('data-active-left-panel="memory"'));
  assert.ok(html.includes('data-active-bottom-panel="runs"'));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(html.includes('href="/ide?workspace=default&amp;book=12'));
  assert.ok(html.includes('panel.left=explorer'));
  assert.ok(html.includes('panel.bottom=artifacts'));
});
