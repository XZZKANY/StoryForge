import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { ChapterCheckHistoryPanel } from '../src/components/chat-window/ChapterCheckHistoryPanel';
import { CHAT_COLUMN } from '../src/components/chat-window/column';
import {
  ContextSummaryPanel,
  LightweightStatus,
  RunActionBar,
} from '../src/components/chat-window/panels';
import type { AgentRun } from '../src/components/chat-window/types';

// 对话占满中右（Ctrl+3）时，底部这些块要和消息、输入框落在同一条居中栏里；
// 它们原本按 384px 右栏设计，铺满后曾横跨整宽、按钮被推到窗口最右。

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

function inColumn(element: Element | null): boolean {
  for (let node = element; node; node = node.parentElement) {
    if (node.classList.contains('max-w-[800px]') && node.classList.contains('mx-auto')) return true;
  }
  return false;
}

const runningRun: AgentRun = {
  id: 'run-1',
  sessionId: 'run-1',
  goal: '看看第 5 章',
  status: 'running',
  steps: [
    { id: 'tool-0-fs.read', title: 'fs.read', tool: 'fs.read', status: 'running', detail: '' },
  ],
};

const controls = {
  onPauseRun: () => undefined,
  onResumeRun: () => undefined,
  onStopRun: () => undefined,
  onApprovePermission: () => undefined,
  onDenyPermission: () => undefined,
};

test('run action bar is a card inside the chat column, not a full-width band', () => {
  const host = mount(renderToStaticMarkup(<RunActionBar run={runningRun} controls={controls} />));
  const bar = host.querySelector('[data-testid="run-action-bar"]');
  assert.ok(bar);
  for (const band of ['border-t', 'shadow-bar-top', 'bg-panel']) {
    assert.equal(bar.classList.contains(band), false, `操作条外层不该再有整宽的 ${band}`);
  }
  const card = bar.firstElementChild;
  assert.ok(card?.className.includes(CHAT_COLUMN));
  assert.ok(card?.classList.contains('border'));
  assert.ok(inColumn(host.querySelector('[data-testid="run-stop"]')));
});

test('delivery-unknown action bar keeps its buttons in the chat column', () => {
  const host = mount(
    renderToStaticMarkup(
      <RunActionBar run={{ ...runningRun, deliveryUnknown: true }} controls={controls} />,
    ),
  );
  assert.ok(inColumn(host.querySelector('[data-testid="run-reconcile"]')));
  assert.equal(
    host.querySelector('[data-testid="run-action-bar"]')?.classList.contains('border-t'),
    false,
  );
});

test('context summary and chapter check history are column-width', () => {
  const context = mount(
    renderToStaticMarkup(
      <ContextSummaryPanel
        currentFileLabel="正文/第005章.md"
        explicitContextPaths={[]}
        contextCandidates={[]}
        contextCandidatesLoading={false}
        contextCandidatesError={null}
        contextPickerOpen
        lastContextBundle={null}
        missingContextPaths={[]}
        onAddContext={() => undefined}
        onTogglePinnedContext={() => undefined}
        onRetryContextCandidates={() => undefined}
      />,
    ),
  );
  assert.ok(inColumn(context.querySelector('[data-testid="context-summary"]')));

  const history = mount(
    renderToStaticMarkup(
      <ChapterCheckHistoryPanel
        history={{
          enabled: true,
          entries: [
            {
              runId: 'run-1',
              artifactId: 1,
              targetPath: '正文/第006章.md',
              createdAt: '2026-10-16T00:00:00',
              check: null,
              checkError: null,
              candidateContent: null,
              candidateError: null,
            },
          ],
          truncated: false,
          loading: false,
          error: null,
          reload: () => undefined,
        }}
      />,
    ),
  );
  const section = history.querySelector('[data-testid="chapter-check-history"]');
  assert.ok(inColumn(section));
  assert.ok(history.querySelector('[data-testid="chapter-check-entry"]'));
  // border-default 不是有效类，会落到 Tailwind 默认的浅灰边线。
  assert.equal(history.innerHTML.includes('border-default'), false);
});

test('decision choices and lightweight status sit in the chat column', () => {
  const patchRun: AgentRun = {
    ...runningRun,
    status: 'waiting',
    steps: [
      {
        id: 'approval',
        title: '等待作者确认',
        tool: 'author.approval',
        status: 'waiting',
        detail: '',
        filePath: 'D:/book/正文/第005章.md',
        patchId: 'patch-1',
      },
    ],
  };
  const decision = mount(renderToStaticMarkup(<RunActionBar run={patchRun} controls={controls} />));
  assert.ok(inColumn(decision.querySelector('[data-testid="run-accept-patch"]')));
  assert.equal(decision.querySelector('[role="dialog"]'), null);

  const status = mount(renderToStaticMarkup(<LightweightStatus text="本轮已停止" retryVisible />));
  assert.ok(inColumn(status.querySelector('button')));
});
