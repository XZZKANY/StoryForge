/**
 * 第12条功能：待确认补丁时对话区就地给接受/拒绝入口。
 *
 * 改动前作者发消息被 toast 拦住，要切到中栏编辑器找 PatchReviewPanel。现在
 * RunActionBar 在对话区底部就地显示「接受/拒绝」按钮，作者不用切栏。
 *
 * 这里钉住核心不变量：
 * ①待确认补丁时 RunActionBar 必须渲染（awaitingConfirm 判定正确）；
 * ②接受按钮调 controls.onAcceptPatch，请求编辑器接受同一 patchId；
 * ③拒绝按钮调 controls.onRejectPatch，请求编辑器清理后再广播拒绝结果。
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
      {
        id: 'approval',
        status: 'waiting',
        detail: '等待作者确认',
        filePath: 'D:/work/ch01.md',
        patchId: 'patch-abc',
      },
    ],
    totalCount: null,
    completedCount: null,
    latestEvent: 'approval',
    ...overrides,
  } as AgentRun;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let composer: HTMLTextAreaElement;

beforeEach(() => {
  acceptCalls.length = 0;
  rejectCalls.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  composer = document.createElement('textarea');
  composer.dataset.testid = 'composer-input';
  document.body.appendChild(composer);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  composer.remove();
});

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

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

test('权限批准后把焦点交还 Composer，避免操作条卸载后焦点落到 body', async () => {
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

  const approve = container.querySelector('[data-testid="run-approve-permission"]');
  assert.ok(approve);
  (approve as HTMLButtonElement).focus();
  act(() => {
    (approve as HTMLButtonElement).click();
  });
  await nextFrame();
  assert.equal(document.activeElement, composer);
});

test('补丁拒绝确认后把焦点交还 Composer', async () => {
  act(() => {
    root.render(<RunActionBar run={makeRun()} controls={mockControls} />);
  });

  const reject = container.querySelector('[data-testid="run-reject-patch"]');
  assert.ok(reject);
  (reject as HTMLButtonElement).focus();
  act(() => {
    (reject as HTMLButtonElement).click();
  });
  const confirm = container.querySelector('[data-testid="run-reject-confirm"]');
  assert.ok(confirm);
  act(() => {
    (confirm as HTMLButtonElement).click();
  });
  await nextFrame();
  assert.equal(document.activeElement, composer);
});

test('拒绝表单顶部的取消只收起草稿并恢复拒绝入口焦点', () => {
  act(() => {
    root.render(<RunActionBar run={makeRun()} controls={mockControls} />);
  });

  const reject = container.querySelector('[data-testid="run-reject-patch"]') as HTMLButtonElement;
  assert.ok(reject);
  act(() => {
    reject.click();
  });
  assert.equal(container.querySelector('[data-testid="run-reject-input"]') !== null, true);

  act(() => {
    reject.click();
  });

  assert.equal(reject.textContent, '拒绝');
  assert.equal(container.querySelector('[data-testid="run-reject-input"]'), null);
  assert.equal(rejectCalls.length, 0, '取消拒绝草稿不应提交拒绝');
  assert.equal(document.activeElement, reject);
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
  const confirmButton = container.querySelector(
    '[data-testid="run-reject-confirm"]',
  ) as HTMLButtonElement;
  assert.ok(confirmButton, '展开后找不到输入框里的确认按钮');

  act(() => {
    confirmButton.click();
  });

  assert.equal(rejectCalls.length, 1, '点确认按钮没调 onRejectPatch');
  assert.equal(rejectCalls[0].direction, '', '空方向应传空串');
});

test('run 已完成或停止时 RunActionBar 不渲染；运行中显示暂停和停止', () => {
  act(() => {
    root.render(<RunActionBar run={makeRun({ status: 'completed' })} controls={mockControls} />);
  });

  assert.equal(container.querySelectorAll('button').length, 0, 'completed 时不该渲染按钮');

  act(() => {
    root.render(<RunActionBar run={makeRun({ status: 'stopped' })} controls={mockControls} />);
  });

  assert.equal(container.querySelectorAll('button').length, 0, 'stopped 时不该渲染按钮');
  assert.equal(container.querySelector('[data-testid="run-action-bar"]'), null);

  act(() => {
    root.render(<RunActionBar run={makeRun({ status: 'running' })} controls={mockControls} />);
  });

  // 第14条：running 时显示暂停和停止按钮
  const buttons = container.querySelectorAll('button');
  assert.equal(buttons.length, 2, 'running 时应有 2 个按钮（暂停 + 停止）');
  assert.ok(container.querySelector('[data-testid="run-pause"]'), '应有暂停按钮');
  assert.ok(container.querySelector('[data-testid="run-stop"]'), '应有停止按钮');
});

for (const change of ['run', 'patch', 'status', 'same'] as const) {
  test(`拒绝草稿跟随当前运行和补丁：${change}`, () => {
    act(() => root.render(<RunActionBar run={makeRun()} controls={mockControls} />));
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="run-reject-patch"]')!.click(),
    );
    const input = container.querySelector<HTMLInputElement>('[data-testid="run-reject-input"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '旧版需要修改动机',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    if (change === 'status')
      act(() =>
        root.render(<RunActionBar run={makeRun({ status: 'running' })} controls={mockControls} />),
      );
    const next = makeRun(
      change === 'run'
        ? { id: 'run-2' }
        : change === 'patch'
          ? { steps: makeRun().steps.map((step) => ({ ...step, patchId: 'new-patch' })) }
          : {},
    );
    act(() =>
      root.render(
        <RunActionBar run={next} controls={{ ...mockControls, busy: change === 'same' }} />,
      ),
    );
    if (change === 'same') {
      assert.equal(container.querySelector('[data-testid="run-reject-input"]') === input, true);
      assert.equal(input.value, '旧版需要修改动机');
    } else {
      assert.equal(container.querySelector('[data-testid="run-reject-input"]') === null, true);
      act(() =>
        container.querySelector<HTMLButtonElement>('[data-testid="run-reject-patch"]')!.click(),
      );
      assert.equal(
        container.querySelector<HTMLInputElement>('[data-testid="run-reject-input"]')!.value,
        '',
      );
    }
    assert.equal(rejectCalls.length, 0);
  });
}

for (const method of ['click', 'enter']) {
  test(`忙碌时拒绝表单不提交也不丢草稿，恢复后可提交：${method}`, () => {
    act(() => root.render(<RunActionBar run={makeRun()} controls={mockControls} />));
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="run-reject-patch"]')!.click(),
    );
    const input = container.querySelector<HTMLInputElement>('[data-testid="run-reject-input"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '保留作者修改方向',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() =>
      root.render(<RunActionBar run={makeRun()} controls={{ ...mockControls, busy: true }} />),
    );
    const confirm = container.querySelector<HTMLButtonElement>(
      '[data-testid="run-reject-confirm"]',
    )!;
    if (method === 'click') {
      assert.equal(confirm.disabled, true);
      act(() => confirm.click());
    } else
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
      });
    assert.equal(rejectCalls.length, 0);
    assert.equal(container.querySelector('[data-testid="run-reject-input"]') === input, true);
    assert.equal(input.value, '保留作者修改方向');
    act(() =>
      root.render(<RunActionBar run={makeRun()} controls={{ ...mockControls, busy: false }} />),
    );
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="run-reject-confirm"]')!.click(),
    );
    assert.deepEqual(rejectCalls, [{ direction: '保留作者修改方向' }]);
  });
}

for (const change of ['outside', 'composer', 'terminal']) {
  test(`操作后的焦点帧尊重当前输入归属：${change}`, async () => {
    act(() => root.render(<RunActionBar run={makeRun()} controls={mockControls} />));
    const accept = container.querySelector<HTMLButtonElement>('[data-testid="run-accept-patch"]')!;
    accept.focus();
    act(() => accept.click());
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      if (change === 'outside') outside.focus();
      else {
        act(() =>
          root.render(
            <RunActionBar run={makeRun({ status: 'completed' })} controls={mockControls} />,
          ),
        );
        if (change === 'composer') {
          composer.remove();
          composer = document.createElement('textarea');
          composer.dataset.testid = 'composer-input';
          document.body.appendChild(composer);
        }
      }
      await act(async () => {
        await nextFrame();
      });
      if (change === 'outside') assert.equal(document.activeElement === outside, true);
      else if (change === 'composer') assert.equal(document.activeElement === composer, false);
      else assert.equal(document.activeElement === composer, true);
      assert.equal(acceptCalls.length, 1);
    } finally {
      outside.remove();
    }
  });
}

for (const method of ['click', 'escape']) {
  test(`忙碌时可取消本地拒绝表单并保留稳定焦点：${method}`, () => {
    act(() => root.render(<RunActionBar run={makeRun()} controls={mockControls} />));
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="run-reject-patch"]')!;
    act(() => trigger.click());
    const input = container.querySelector<HTMLInputElement>('[data-testid="run-reject-input"]')!;
    act(() =>
      root.render(<RunActionBar run={makeRun()} controls={{ ...mockControls, busy: true }} />),
    );
    input.focus();
    act(() => {
      if (method === 'click') trigger.click();
      else
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
    });
    assert.equal(container.querySelector('[data-testid="run-reject-input"]') === null, true);
    const bar = container.querySelector('[data-testid="run-action-bar"]');
    assert.equal(document.activeElement === bar, true);
    assert.equal(trigger.disabled, true, '关闭后不得在 busy 时重新打开或提交');
    act(() => trigger.click());
    assert.equal(container.querySelector('[data-testid="run-reject-input"]') === null, true);
    assert.equal(rejectCalls.length, 0);
    assert.equal(acceptCalls.length, 0);
    act(() => root.render(<RunActionBar run={makeRun()} controls={mockControls} />));
    assert.equal(document.activeElement === bar, true, 'busy 解除不应擅自移动焦点');
    act(() => trigger.click());
    assert.equal(
      container.querySelector<HTMLInputElement>('[data-testid="run-reject-input"]')?.value,
      '',
    );
  });
}
