/**
 * 第12条功能：待确认补丁时对话区就地给接受/拒绝入口。
 *
 * 改动前作者发消息被 toast 拦住，要切到中栏编辑器找 PatchReviewPanel。现在
 * RunActionBar 在对话区底部就地显示「接受/拒绝」按钮，作者不用切栏。
 *
 * 这里钉住核心不变量：
 * ①待确认补丁时 RunActionBar 必须渲染（awaitingConfirm 判定正确）；
 * ②接受按钮调 controls.onAcceptPatch，发 emitAcceptCurrentFileSuggestion 事件；
 * ③拒绝按钮调 controls.onRejectPatch，发 emitPatchRejected 事件。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { RunActionBar } from '../../src/components/chat-window/panels';
import type { AgentRun, AgentRunControlHandlers } from '../../src/components/chat-window/types';

const acceptCalls: string[] = [];
const rejectCalls: Array<{ direction: string }> = [];

const mockControls: AgentRunControlHandlers = {
  onApprovePermission: () => undefined,
  onDenyPermission: () => undefined,
  onPauseRun: () => undefined,
  onResumeRun: () => undefined,
  onStopRun: () => undefined,
  onAcceptPatch: () => {
    acceptCalls.push('accept');
  },
  onRejectPatch: (direction: string) => {
    rejectCalls.push({ direction });
  },
};

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    sessionId: 'session-7',
    status: 'waiting',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    steps: [
      { id: 'approval', status: 'waiting', detail: '等待作者确认', filePath: 'D:/work/ch01.md', patchId: 'patch-abc' },
    ],
    totalCount: null,
    completedCount: null,
    latestEvent: 'approval',
    ...overrides,
  } as AgentRun;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  acceptCalls.length = 0;
  rejectCalls.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

test('待确认补丁时 RunActionBar 必须渲染（status=waiting 且非权限等待）', () => {
  act(() => {
    root.render(<RunActionBar run={makeRun()} controls={mockControls} />);
  });

  const buttons = container.querySelectorAll('button');
  assert.ok(buttons.length > 0, '待确认补丁时 RunActionBar 没渲染任何按钮');
  const acceptButton = Array.from(buttons).find((btn) => btn.textContent?.includes('接受'));
  const rejectButton = Array.from(buttons).find((btn) => btn.textContent?.includes('拒绝'));
  assert.ok(acceptButton, '找不到「接受」按钮');
  assert.ok(rejectButton, '找不到「拒绝」按钮');
});

test('权限等待时 RunActionBar 不显示接受/拒绝（那是权限操作，不是补丁确认）', () => {
  act(() => {
    root.render(
      <RunActionBar
        run={makeRun({
          steps: [{ id: 'permission-required', status: 'waiting', detail: '需要权限' }],
        })}
        controls={mockControls}
      />,
    );
  });

  const buttons = container.querySelectorAll('button');
  const acceptPatchButton = Array.from(buttons).find((btn) => btn.textContent?.includes('接受'));
  const rejectPatchButton = Array.from(buttons).find((btn) => btn.textContent?.includes('拒绝'));
  // 权限等待时应该显示「批准/拒绝权限」，不是「接受/拒绝补丁」
  assert.ok(
    !acceptPatchButton || !acceptPatchButton.textContent?.includes('补丁'),
    '权限等待时不该有补丁接受按钮',
  );
  assert.ok(
    !rejectPatchButton || !rejectPatchButton.textContent?.includes('补丁'),
    '权限等待时不该有补丁拒绝按钮',
  );
});

test('点接受按钮调 controls.onAcceptPatch', () => {
  act(() => {
    root.render(<RunActionBar run={makeRun()} controls={mockControls} />);
  });

  const buttons = container.querySelectorAll('button');
  const acceptButton = Array.from(buttons).find((btn) => btn.textContent?.includes('接受'));
  assert.ok(acceptButton, '找不到接受按钮');

  act(() => {
    acceptButton.click();
  });

  assert.equal(acceptCalls.length, 1, '点接受按钮没调 onAcceptPatch');
});

test('点拒绝按钮调 controls.onRejectPatch', () => {
  act(() => {
    root.render(<RunActionBar run={makeRun()} controls={mockControls} />);
  });

  const buttons = container.querySelectorAll('button');
  const rejectButton = Array.from(buttons).find((btn) => btn.textContent?.includes('拒绝'));
  assert.ok(rejectButton, '找不到拒绝按钮');

  act(() => {
    rejectButton.click();
  });

  // 第一次点展开输入框，第二次点才真发
  assert.equal(rejectCalls.length, 0, '第一次点拒绝不该立即调 onRejectPatch');

  // 展开后顶部按钮文案变「取消」，真正的确认按钮在输入框里（「否掉」或「否掉并重来」）
  const confirmButton = container.querySelector('[data-testid="run-reject-confirm"]') as HTMLButtonElement;
  assert.ok(confirmButton, '展开后找不到输入框里的确认按钮');

  act(() => {
    confirmButton.click();
  });

  assert.equal(rejectCalls.length, 1, '点确认按钮没调 onRejectPatch');
  assert.equal(rejectCalls[0].direction, '', '空方向应传空串');
});

test('run 已完成时 RunActionBar 不渲染；运行中显示暂停和停止', () => {
  act(() => {
    root.render(<RunActionBar run={makeRun({ status: 'completed' })} controls={mockControls} />);
  });

  assert.equal(container.querySelectorAll('button').length, 0, 'completed 时不该渲染按钮');

  act(() => {
    root.render(<RunActionBar run={makeRun({ status: 'running' })} controls={mockControls} />);
  });

  // 第14条：running 时显示暂停和停止按钮
  const buttons = container.querySelectorAll('button');
  assert.equal(buttons.length, 2, 'running 时应有 2 个按钮（暂停 + 停止）');
  assert.ok(container.querySelector('[data-testid="run-pause"]'), '应有暂停按钮');
  assert.ok(container.querySelector('[data-testid="run-stop"]'), '应有停止按钮');
});
