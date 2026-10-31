import assert from 'node:assert/strict';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { CHAT_COLUMN } from '../src/components/chat-window/column';
import { ComposerBox } from '../src/components/chat-window/Composer';
import {
  ContextSummaryPanel,
  LightweightStatus,
  RunActionBar,
} from '../src/components/chat-window/panels';
import type { AgentRun } from '../src/components/chat-window/types';
import { WriteBatchProgressBar } from '../src/components/chat-window/WriteBatchPanel';

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
  const host = mount(
    renderToStaticMarkup(
      <RunActionBar run={{ ...runningRun, status: 'paused' }} controls={controls} />,
    ),
  );
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

// 章节检查记录已挪进对话头的小浮窗，不再占对话栏，不在这里校验栏宽。
// 参考资料和批量写章进度是输入框顶边的小条，不再各自是一张悬在输入框上方的卡。
function composerWithDock(dock: ReactNode): HTMLElement {
  return mount(
    renderToStaticMarkup(
      <ComposerBox
        value=""
        disabled={false}
        busy={false}
        explicitContextPaths={[]}
        onAddContext={() => undefined}
        onChange={() => undefined}
        onSubmit={() => undefined}
        permissionProfile="ask"
        onPermissionProfileChange={() => undefined}
        dock={dock}
      />,
    ),
  );
}

test('context summary and write-batch progress are rows docked on the composer', () => {
  const host = composerWithDock(
    <>
      <WriteBatchProgressBar
        progress={{ ordinal: 7, index: 1, total: 4, used: '0 万', cap: '23.4 万', stopping: false }}
        onStop={() => undefined}
      />
      <ContextSummaryPanel
        compact
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
      />
    </>,
  );
  const dock = host.querySelector('[data-testid="composer-dock"]');
  assert.ok(inColumn(dock));
  assert.equal(dock?.nextElementSibling?.tagName, 'FORM', '小条要紧贴在输入框上沿');
  assert.ok(dock?.contains(host.querySelector('[data-testid="context-summary"]')));
  assert.ok(dock?.contains(host.querySelector('[data-testid="write-batch-progress"]')));
  for (const testid of ['context-summary', 'write-batch-progress']) {
    const row = host.querySelector(`[data-testid="${testid}"]`)!;
    for (const card of ['border', 'rounded-lg', 'shadow-sm']) {
      assert.equal(row.classList.contains(card), false, `${testid} 不该自带 ${card} 成一张卡`);
    }
  }
});

test('composer dock collapses when no row has anything to say', () => {
  const dock = composerWithDock(null).querySelector('[data-testid="composer-dock"]');
  assert.equal(dock?.childElementCount, 0);
  assert.ok(dock?.classList.contains('empty:hidden'));
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
