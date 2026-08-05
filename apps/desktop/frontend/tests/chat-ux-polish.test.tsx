import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { AgentStepsPanel } from '../src/components/AgentStepsPanel';
import { AssistantMarkdown } from '../src/components/chat-window/AssistantMarkdown';
import { runStatusText } from '../src/components/chat-window/display-utils';
import {
  ContextSummaryPanel,
  MessageItem,
  RunActionBar,
  WritingRunProgressPanel,
} from '../src/components/chat-window/panels';
import type { AgentRun } from '../src/components/chat-window/types';

test('assistant message renders markdown structure, not raw markers', () => {
  const html = renderToStaticMarkup(
    <MessageItem
      message={{
        role: 'assistant',
        content: '**加粗** 与 `code`\n\n- 一项\n- 二项',
      }}
    />,
  );
  assert.match(html, /data-testid="assistant-markdown"/);
  assert.match(html, /<strong>/);
  assert.match(html, /<code>/);
  assert.match(html, /<li>/);
  assert.doesNotMatch(html, /\*\*加粗\*\*/);
});

test('assistant markdown renders GFM tables and strikethrough (remark-gfm)', () => {
  const html = renderToStaticMarkup(
    <MessageItem
      message={{
        role: 'assistant',
        content: '| 章节 | 状态 |\n| --- | --- |\n| 第1章 | ~~草稿~~ |',
      }}
    />,
  );
  assert.match(html, /<table>/);
  assert.match(html, /<td>/);
  assert.match(html, /<del>/);
  // GFM 生效后表格/删除线不再渲染成裸符号
  assert.doesNotMatch(html, /\| 章节 \|/);
});

test('user message stays plain text bubble even with markdown-looking content', () => {
  const html = renderToStaticMarkup(
    <MessageItem message={{ role: 'user', content: '# 标题\n*星号*' }} />,
  );
  assert.match(html, /data-testid="user-message"/);
  assert.doesNotMatch(html, /data-testid="assistant-markdown"/);
  assert.match(html, /# 标题/);
  assert.doesNotMatch(html, /<h1>/);
});

test('AssistantMarkdown skips raw HTML', () => {
  const html = renderToStaticMarkup(
    <AssistantMarkdown content={'你好 <script>alert(1)</script> **ok**'} />,
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<strong>/);
});

test('compact context summary collapses pin list until expanded', () => {
  const collapsed = renderToStaticMarkup(
    <ContextSummaryPanel
      compact
      currentFileLabel="chapters/01.md"
      explicitContextPaths={['notes/a.md']}
      contextCandidates={[]}
      contextCandidatesLoading={false}
      contextCandidatesError={null}
      contextPickerOpen={false}
      lastContextBundle={null}
      missingContextPaths={[]}
      onAddContext={() => undefined}
      onTogglePinnedContext={() => undefined}
      onRetryContextCandidates={() => undefined}
    />,
  );
  assert.match(collapsed, /data-compact="true"/);
  assert.match(collapsed, /data-expanded="false"/);
  assert.doesNotMatch(collapsed, /data-testid="pinned-context-list"/);
  assert.match(collapsed, /固定 1/);
});

test('run action bar shows pause button when running', () => {
  const run: AgentRun = {
    id: 'run-42',
    sessionId: 's1',
    goal: 'revise',
    status: 'running',
    steps: [{ id: 's1', title: '思考', tool: 'think', status: 'running', detail: '' }],
  };
  const html = renderToStaticMarkup(
    <RunActionBar
      run={run}
      controls={{
        onApprovePermission: () => undefined,
        onDenyPermission: () => undefined,
        onPauseRun: () => undefined,
        onResumeRun: () => undefined,
        onStopRun: () => undefined,
      }}
    />,
  );
  // 第14条：run 控制统一到 RunActionBar，运行态显示「正在处理 + 暂停 + 停止」
  assert.match(html, /data-testid="run-action-bar"/);
  assert.match(html, /正在处理/);
  assert.match(html, /data-testid="run-pause"/);
  assert.match(html, /data-testid="run-stop"/);
});

test('run action bar shows permission CTAs when waiting', () => {
  const run: AgentRun = {
    id: 'run-9',
    sessionId: 's1',
    goal: 'revise',
    status: 'waiting',
    steps: [
      {
        id: 'permission-required',
        title: '权限',
        tool: 'permission',
        status: 'waiting',
        detail: '',
      },
    ],
  };
  const html = renderToStaticMarkup(
    <RunActionBar
      run={run}
      controls={{
        onApprovePermission: () => undefined,
        onDenyPermission: () => undefined,
        onPauseRun: () => undefined,
        onResumeRun: () => undefined,
        onStopRun: () => undefined,
      }}
    />,
  );
  assert.match(html, /等待你确认/);
  assert.match(html, /data-testid="run-approve-permission"/);
  assert.match(html, /data-testid="run-deny-permission"/);
});

test('run action bar drops destructive stop while awaiting patch confirm', () => {
  // status==='waiting' 且非权限 = 等你在编辑器确认 diff：run 已出结果，「停止」会误标 failed
  // 却不清补丁，故这里只给去向提示、不渲染停止键。
  const run: AgentRun = {
    id: 'run-77',
    sessionId: 's1',
    goal: 'revise',
    status: 'waiting',
    steps: [
      { id: 'file-revision', title: '修订', tool: 'file.revise', status: 'waiting', detail: '' },
    ],
  };
  const html = renderToStaticMarkup(
    <RunActionBar
      run={run}
      controls={{
        onApprovePermission: () => undefined,
        onDenyPermission: () => undefined,
        onPauseRun: () => undefined,
        onResumeRun: () => undefined,
        onStopRun: () => undefined,
      }}
    />,
  );
  assert.match(html, /AI 修订已生成，可接受或拒绝/);
  assert.match(html, /data-testid="run-accept-patch"/);
  assert.match(html, /data-testid="run-reject-patch"/);
  assert.doesNotMatch(html, /data-testid="run-stop"/);
  assert.doesNotMatch(html, /data-testid="run-approve-permission"/);
});

test('run action bar offers resume (not a dead end) when paused', () => {
  const run: AgentRun = {
    id: 'run-88',
    sessionId: 's1',
    goal: 'revise',
    status: 'paused',
    steps: [{ id: 's1', title: '思考', tool: 'think', status: 'running', detail: '' }],
  };
  const html = renderToStaticMarkup(
    <RunActionBar
      run={run}
      controls={{
        onApprovePermission: () => undefined,
        onDenyPermission: () => undefined,
        onPauseRun: () => undefined,
        onResumeRun: () => undefined,
        onStopRun: () => undefined,
      }}
    />,
  );
  assert.match(html, /已暂停/);
  assert.match(html, /data-testid="run-resume"/);
  // 暂停不是死胡同：既能恢复，也保留停止。
  assert.match(html, /data-testid="run-stop"/);
});

test('runStatusText renders author stop as neutral, not a failure', () => {
  const stopped: AgentRun = { id: 'r', sessionId: 's', goal: 'g', status: 'stopped', steps: [] };
  const paused: AgentRun = { ...stopped, status: 'paused' };
  assert.equal(runStatusText(stopped), '已由你停止本轮。');
  assert.doesNotMatch(runStatusText(stopped) ?? '', /遇到问题/);
  assert.match(runStatusText(paused) ?? '', /已暂停/);
});

test('tool step metrics render as key-value chips, not one crammed 中文 string', () => {
  const run: AgentRun = {
    id: 'run-metrics',
    sessionId: 's1',
    goal: 'revise',
    status: 'running',
    steps: [
      {
        id: 'tool-0-file.review',
        title: 'file.review',
        tool: 'file.review',
        status: 'completed',
        detail: 'completed；模型 deepseek-v4；42ms；问题 3 个',
        metrics: [
          { label: '模型', value: 'deepseek-v4' },
          { label: '延迟', value: '42ms' },
          { label: '问题', value: '3 个' },
        ],
      },
    ],
  };
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.match(html, /data-testid="step-metrics"/);
  const chipCount = html.match(/data-testid="step-metric-chip"/g)?.length ?? 0;
  assert.equal(chipCount, 3);
  assert.match(html, /延迟/);
  assert.match(html, /42ms/);
});

test('compact context summary surfaces truncation on the fold header, not only when expanded', () => {
  const bundle = {
    files: [],
    summary: { counts: {} },
    budget: {
      fileCount: 8,
      charCount: 12000,
      maxFiles: 8,
      maxExcerptChars: 2000,
      truncated: true,
      pinnedFileCount: 0,
      missingPinnedFiles: [],
    },
  } as unknown as Parameters<typeof ContextSummaryPanel>[0]['lastContextBundle'];
  const html = renderToStaticMarkup(
    <ContextSummaryPanel
      compact
      currentFileLabel="chapters/01.md"
      explicitContextPaths={[]}
      contextCandidates={[]}
      contextCandidatesLoading={false}
      contextCandidatesError={null}
      contextPickerOpen={false}
      lastContextBundle={bundle}
      missingContextPaths={[]}
      onAddContext={() => undefined}
      onTogglePinnedContext={() => undefined}
      onRetryContextCandidates={() => undefined}
    />,
  );
  assert.match(html, /data-compact="true"/);
  assert.match(html, /data-expanded="false"/);
  assert.match(html, /data-testid="context-truncated-badge"/);
});

test('writing run progress draws a meter when total chapters is known', () => {
  const html = renderToStaticMarkup(
    <WritingRunProgressPanel
      projection={{
        writingRunId: 700,
        status: 'running',
        currentChapterIndex: 3,
        totalChapters: 10,
        completedCount: 4,
        latestEvent: 'progress',
      }}
    />,
  );
  assert.match(html, /data-testid="writing-run-progress-meter"/);
  assert.match(html, /aria-valuenow="40"/);
});

test('writing run progress omits the meter when total chapters is unknown', () => {
  const html = renderToStaticMarkup(
    <WritingRunProgressPanel
      projection={{
        writingRunId: 701,
        status: 'running',
        currentChapterIndex: null,
        totalChapters: null,
        completedCount: 2,
        latestEvent: 'progress',
      }}
    />,
  );
  assert.doesNotMatch(html, /data-testid="writing-run-progress-meter"/);
});
