import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { AgentStepsPanel } from '../src/components/AgentStepsPanel';
import { AssistantMarkdown } from '../src/components/chat-window/AssistantMarkdown';
import { contextBudgetText, runStatusText } from '../src/components/chat-window/display-utils';
import { formatElapsed } from '../src/components/chat-window/RunElapsed';
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

test('pinned references do not create a permanent context card before it is requested', () => {
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
  assert.equal(collapsed, '');
});

test('running 时没有操作条：进度在思考过程那一行，停止在输入框里', () => {
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
  // 10-20 作者拍板学 Claude / Codex：跑着时不再有「转圈 + 步骤名 + 暂停 + 停止」那条操作条。
  assert.equal(html, '');
  const process = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.match(process, /data-testid="thinking-active-step"/);
  assert.match(process, /sf-thinking-dots/);
  assert.match(process, /思考/);
  assert.doesNotMatch(process, /data-testid="run-pause"/);
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
  assert.match(html, /AI 修订已生成/);
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

test('tool step metrics render as one muted meta on the row, not chips', () => {
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
        detail: '模型 deepseek-v4；不到 1 秒；问题 3 个',
        metrics: ['问题 3 个', '不到 1 秒'],
        model: 'deepseek-v4',
      },
    ],
  };
  const html = renderToStaticMarkup(<AgentStepsPanel run={run} />);
  assert.match(html, /data-testid="step-meta">问题 3 个 · 不到 1 秒</);
  assert.doesNotMatch(html, /step-metric/);
  assert.doesNotMatch(html, /延迟/);
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
  assert.match(html, /data-testid="context-truncated-badge"[^>]*>已截断（原因未记录）</);
});

test('参考覆盖警告按原因分开，只送摘录不算警告，分类计数标明是项目口径', () => {
  const base = {
    projectRoot: 'D:/book',
    currentFile: null,
    files: [],
    summary: { hasStoryStructure: true, counts: { outline: 2, setting: 1, draft: 10 } },
    budget: {
      fileCount: 8,
      charCount: 9600,
      maxFiles: 8,
      maxExcerptChars: 1200,
      truncated: false,
      overflowCount: 0,
      unreadableCount: 0,
      pinnedFileCount: 0,
      missingPinnedFiles: [],
    },
  } as unknown as Parameters<typeof contextBudgetText>[0] & object;
  const excerptOnly = contextBudgetText(base);
  assert.equal(excerptOnly, '上下文 8/8 文件，9600 字符；项目里：大纲2、设定1、正文10');
  const both = contextBudgetText({
    ...base,
    budget: { ...base.budget, truncated: true, overflowCount: 3, unreadableCount: 1 },
  });
  assert.match(both, /；超出席位 3；读取失败 1；/);
  assert.doesNotMatch(both, /已截断/);
  const onlyUnreadable = contextBudgetText({
    ...base,
    budget: { ...base.budget, truncated: true, unreadableCount: 2 },
  });
  assert.match(onlyUnreadable, /读取失败 2/);
  assert.doesNotMatch(onlyUnreadable, /超出席位/);
  const legacy = contextBudgetText({
    ...base,
    budget: {
      ...base.budget,
      truncated: true,
      overflowCount: undefined,
      unreadableCount: undefined,
    },
  });
  assert.match(legacy, /已截断（原因未记录）/);
  assert.doesNotMatch(legacy, /超出席位|读取失败/);

  const panel = (budget: typeof base.budget) =>
    renderToStaticMarkup(
      <ContextSummaryPanel
        compact
        currentFileLabel="chapters/01.md"
        explicitContextPaths={[]}
        contextCandidates={[]}
        contextCandidatesLoading={false}
        contextCandidatesError={null}
        contextPickerOpen={false}
        lastContextBundle={{ ...base, budget }}
        missingContextPaths={[]}
        onAddContext={() => undefined}
        onTogglePinnedContext={() => undefined}
        onRetryContextCandidates={() => undefined}
      />,
    );
  assert.equal(panel(base.budget), '');
  const warned = panel({ ...base.budget, truncated: true, overflowCount: 3, unreadableCount: 1 });
  assert.match(warned, /data-testid="context-truncated-badge"[^>]*>超出席位 3</);
  assert.match(warned, /data-testid="context-truncated-badge"[^>]*>读取失败 1</);
});

test('the typing dot hangs after the last character, inside the deepest last block', () => {
  const place = (content: string) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<AssistantMarkdown content={content} streaming />);
    const carets = host.querySelectorAll('[data-testid="stream-indicator"]');
    assert.equal(carets.length, 1);
    return carets[0].parentElement?.tagName.toLowerCase();
  };
  assert.equal(place('第一段\n\n第二段'), 'p');
  assert.equal(place('要点：\n\n- 一项\n- 二项'), 'li');
  assert.equal(place('> 卷帘门底下有一道拖痕'), 'p');
  assert.equal(place('**粗体结尾**'), 'strong');
  const done = renderToStaticMarkup(<AssistantMarkdown content="第一段" />);
  assert.doesNotMatch(done, /stream-indicator/);
});

test('waiting and working show dots without words; only problems are spelled out', () => {
  const render = (phase: 'waiting' | 'streaming' | 'working' | 'interrupted') => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <MessageItem
        message={{
          role: 'assistant',
          content: phase === 'waiting' ? '' : '正文',
          stream: { runId: 'r', phase },
        }}
      />,
    );
    const status = host.querySelector('[data-testid="stream-phase"]');
    const visible = [...(status?.querySelectorAll('span') ?? [])]
      .filter((node) => !node.closest('.sr-only') && node.textContent?.trim())
      .map((node) => node.textContent);
    return { host, status, visible };
  };
  for (const phase of ['waiting', 'streaming', 'working'] as const) {
    const { status, visible } = render(phase);
    assert.equal(status?.getAttribute('role'), 'status');
    assert.deepEqual(visible, [], `${phase} 不该再另起一行写字`);
  }
  assert.ok(render('waiting').host.querySelector('.sf-thinking-dots:not(.sf-thinking-dots--idle)'));
  assert.ok(render('working').host.querySelector('.sf-thinking-dots--idle'));
  assert.ok(render('streaming').host.querySelector('.sf-stream-caret'));
  assert.deepEqual(render('interrupted').visible, ['回复未完成']);
});

test('思考过程那一行在跑着时报已用时间', () => {
  assert.equal(formatElapsed(5), '5 秒');
  assert.equal(formatElapsed(65), '1 分 5 秒');
  assert.equal(formatElapsed(120), '2 分');
  const controls = {
    onApprovePermission: () => undefined,
    onDenyPermission: () => undefined,
    onPauseRun: () => undefined,
    onResumeRun: () => undefined,
    onStopRun: () => undefined,
  };
  const run: AgentRun = {
    id: 'run-1',
    sessionId: 'run-1',
    goal: '改结尾',
    status: 'running',
    steps: [{ id: 's1', title: '思考', tool: 'think', status: 'running', detail: '' }],
    startedAt: Date.now() - 65_000,
  };
  assert.equal(renderToStaticMarkup(<RunActionBar run={run} controls={controls} />), '');
  assert.match(renderToStaticMarkup(<AgentStepsPanel run={run} />), /1 分 5 秒/);
  const fresh = renderToStaticMarkup(<AgentStepsPanel run={{ ...run, startedAt: Date.now() }} />);
  assert.doesNotMatch(fresh, /data-testid="run-elapsed"/);
});
