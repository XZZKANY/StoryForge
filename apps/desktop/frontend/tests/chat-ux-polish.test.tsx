import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { AssistantMarkdown } from '../src/components/chat-window/AssistantMarkdown';
import {
  ContextSummaryPanel,
  MessageItem,
  RunActionBar,
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

test('run action bar uses author copy and exposes stop control', () => {
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
  assert.match(html, /data-testid="run-action-bar"/);
  assert.match(html, /正在处理/);
  assert.doesNotMatch(html, /AgentRun #/);
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
  assert.match(html, /在编辑器里确认修订/);
  assert.doesNotMatch(html, /data-testid="run-stop"/);
  assert.doesNotMatch(html, /data-testid="run-approve-permission"/);
});
