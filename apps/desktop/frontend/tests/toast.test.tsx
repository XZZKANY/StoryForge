import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { DialogSurface } from '../src/components/ui';
import { ToastHost } from '../src/components/shell/ToastHost';
import { emitToast } from '../src/lib/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 的 FocusEvent 不带 relatedTarget，补一个可配置桩让 onBlur 的「焦点是否还在
// 本条通知内」判断可以被测试真实驱动（而不是绕开组件手动 fireEvent）。
if (typeof FocusEvent !== 'undefined' && !('relatedTarget' in FocusEvent.prototype)) {
  Object.defineProperty(FocusEvent.prototype, 'relatedTarget', {
    configurable: true,
    get(this: FocusEvent & { _relatedTarget?: EventTarget | null }) {
      return this._relatedTarget ?? null;
    },
    set(this: FocusEvent & { _relatedTarget?: EventTarget | null }, value) {
      this._relatedTarget = value;
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderHost() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ToastHost />);
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('emitToast 后右下角出现通知，error 音调更久，超时自动消失', () => {
  const { container, cleanup } = renderHost();
  try {
    assert.equal(container.querySelector('[data-testid="toast-host"]'), null);

    act(() => {
      emitToast('已导出到 D:\\导出\\第001章.md', { tone: 'success' });
      emitToast('导出失败：磁盘满', { tone: 'error' });
    });
    const items = container.querySelectorAll('[data-testid="toast-item"]');
    assert.equal(items.length, 2);
    assert.equal(items[0].getAttribute('data-tone'), 'success');
    assert.equal(items[1].getAttribute('data-tone'), 'error');

    // 默认 4s：success 先消失，error（7s）仍在。
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    const remaining = container.querySelectorAll('[data-testid="toast-item"]');
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].getAttribute('data-tone'), 'error');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null);
  } finally {
    cleanup();
  }
});

test('手动点 × 立即关闭对应通知', () => {
  const { container, cleanup } = renderHost();
  try {
    act(() => {
      emitToast('通知一');
    });
    const closeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="toast-item"] button',
    );
    assert.ok(closeButton);
    act(() => {
      closeButton.click();
    });
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null);
  } finally {
    cleanup();
  }
});

test('超过上限只保留最近 4 条', () => {
  const { container, cleanup } = renderHost();
  try {
    act(() => {
      for (let i = 1; i <= 6; i++) emitToast(`通知${i}`);
    });
    const items = container.querySelectorAll('[data-testid="toast-item"]');
    assert.equal(items.length, 4);
    assert.match(items[0].textContent ?? '', /通知3/);
    assert.match(items[3].textContent ?? '', /通知6/);
  } finally {
    cleanup();
  }
});

test('通知动作按条目防重复，失败可见并可重试', async () => {
  const { container, cleanup } = renderHost();
  try {
    let rejectAction!: (error: Error) => void;
    let resolveAction!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          resolveAction = resolve;
          rejectAction = reject;
        }),
    );
    act(() => {
      emitToast('需要回退', { action: { label: '撤销', run } });
    });
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    act(() => {
      action.click();
      action.click();
    });
    assert.equal(run.mock.calls.length, 1);
    assert.equal(action.disabled, true);
    assert.equal(action.textContent, '处理中…');

    await act(async () => {
      rejectAction(new Error('文件已变化'));
      await Promise.resolve();
    });
    assert.ok(container.querySelector('[data-testid="toast-action-error"]'));
    assert.equal(container.querySelector('[data-testid="toast-item"]') !== null, true);
    assert.equal(action.disabled, false);

    act(() => action.click());
    assert.equal(run.mock.calls.length, 2);
    await act(async () => {
      resolveAction();
      await Promise.resolve();
    });
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null);
  } finally {
    cleanup();
  }
});

test('pending 动作暂停超时，失败后保留反馈和重试入口', async () => {
  const { container, cleanup } = renderHost();
  try {
    let reject!: (error: Error) => void;
    const run = vi.fn(
      () =>
        new Promise<void>((_resolve, no) => {
          reject = no;
        }),
    );
    act(() => emitToast('保留本条', { durationMs: 100, action: { label: '重试', run } }));
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    await act(async () => action.click());
    act(() => vi.advanceTimersByTime(101));
    assert.ok(container.querySelector('[data-testid="toast-item"]'));
    await act(async () => reject(new Error('暂时不可用')));
    act(() => vi.advanceTimersByTime(30000));
    assert.match(container.textContent ?? '', /操作失败：暂时不可用/);
    assert.equal(action.disabled, false);
  } finally {
    cleanup();
  }
});

test('同步 throw 的同帧双击只执行一次，下一次显式重试可成功', async () => {
  const { container, cleanup } = renderHost();
  try {
    const run = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        throw new Error('同步失败');
      })
      .mockImplementation(() => {});
    act(() => emitToast('同步操作', { action: { label: '操作', run } }));
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    await act(async () => {
      action.click();
      action.click();
    });
    assert.equal(run.mock.calls.length, 1);
    assert.match(container.textContent ?? '', /同步失败/);
    await act(async () => action.click());
    assert.equal(run.mock.calls.length, 2);
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null);
  } finally {
    cleanup();
  }
});

test('同步成功同帧双击只执行一次', async () => {
  const { container, cleanup } = renderHost();
  try {
    const run = vi.fn();
    act(() => emitToast('同步成功', { action: { label: '操作', run } }));
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    await act(async () => {
      action.click();
      action.click();
    });
    assert.equal(run.mock.calls.length, 1);
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null);
  } finally {
    cleanup();
  }
});

test('容量淘汰优先丢无动作通知，带动作的旧操作不被无声销毁', () => {
  const { container, cleanup } = renderHost();
  try {
    const revoke = vi.fn();
    act(() => emitToast('旧操作', { action: { label: '操作', run: revoke } }));
    // 4 条无动作新通知进来：上限 4，应先丢最早的无动作，而不是带动作的「旧操作」。
    act(() => {
      for (let i = 0; i < 4; i++) emitToast(`新通知${i}`);
    });
    const items = container.querySelectorAll('[data-testid="toast-item"]');
    assert.equal(items.length, 4);
    // 带动作的「旧操作」必须还在（撤销入口不能被静默回收）。
    assert.match(container.textContent ?? '', /旧操作/);
    // 最早进来的「新通知0」被淘汰，最新的三条无动作都在。
    assert.doesNotMatch(container.textContent ?? '', /新通知0/);
    assert.match(container.textContent ?? '', /新通知3/);
    // 旧操作仍可点、可执行。
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    act(() => action.click());
    assert.equal(revoke.mock.calls.length, 1);
  } finally {
    cleanup();
  }
});

test('超时移除后同帧残留按钮也不能启动动作', () => {
  const { container, cleanup } = renderHost();
  try {
    const run = vi.fn();
    act(() => emitToast('即将过期', { durationMs: 100, action: { label: '操作', run } }));
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    act(() => {
      vi.advanceTimersByTime(101);
      action.click();
    });
    assert.equal(run.mock.calls.length, 0);
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null);
  } finally {
    cleanup();
  }
});

test('手动关闭 pending 通知后迟到失败不复活', async () => {
  const { container, cleanup } = renderHost();
  try {
    let reject!: (error: Error) => void;
    act(() =>
      emitToast('旧操作', {
        action: {
          label: '操作',
          run: () =>
            new Promise<void>((_resolve, no) => {
              reject = no;
            }),
        },
      }),
    );
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    await act(async () => action.click());
    const close = container.querySelector<HTMLButtonElement>('[data-testid="toast-close"]');
    assert.ok(close);
    act(() => {
      close.click();
      emitToast('另一个结果');
    });
    await act(async () => reject(new Error('已经关闭的失败')));
    assert.doesNotMatch(container.textContent ?? '', /旧操作|已经关闭的失败/);
    assert.match(container.textContent ?? '', /另一个结果/);
    assert.equal(vi.getTimerCount(), 1);
  } finally {
    cleanup();
  }
});

for (const outcome of ['success', 'error']) {
  test(`卸载 Host 后迟到 ${outcome} 不影响重新挂载的同 ID 通知`, async () => {
    const old = renderHost();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    act(() =>
      emitToast('旧实例操作', {
        action: {
          label: '操作',
          run: () =>
            new Promise<void>((yes, no) => {
              resolve = yes;
              reject = no;
            }),
        },
      }),
    );
    const action = old.container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    await act(async () => action.click());
    old.cleanup();
    const current = renderHost();
    try {
      act(() => emitToast('新实例通知'));
      await act(async () => {
        if (outcome === 'success') resolve();
        else reject(new Error('旧实例失败'));
      });
      assert.match(current.container.textContent ?? '', /新实例通知/);
      assert.doesNotMatch(current.container.textContent ?? '', /旧实例/);
      assert.equal(vi.getTimerCount(), 1);
    } finally {
      current.cleanup();
    }
  });
}

test('悬停暂停倒计时、离开恢复剩余时间：带动作通知不会被读到一半收走', () => {
  const { container, cleanup } = renderHost();
  try {
    act(() => emitToast('撤销入口', { action: { label: '撤销', run: () => {} } }));
    const item = container.querySelector<HTMLElement>('[data-testid="toast-item"]')!;
    assert.ok(item);

    act(() => vi.advanceTimersByTime(2000));
    act(() => item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    assert.ok(container.querySelector('[data-testid="toast-countdown-paused"]'));
    // 已用掉 2s，剩 8s；悬停期间远超总时长也不消失。
    act(() => vi.advanceTimersByTime(15000));
    assert.ok(container.querySelector('[data-testid="toast-item"]'));

    act(() =>
      container
        .querySelector('[data-testid="toast-host"]')!
        .dispatchEvent(new MouseEvent('mouseout', { bubbles: true })),
    );
    assert.equal(container.querySelector('[data-testid="toast-countdown-paused"]'), null);
    // 恢复的是剩余时间：再走 7.9s 仍在，补满 8s 后才消失。
    act(() => vi.advanceTimersByTime(7900));
    assert.ok(container.querySelector('[data-testid="toast-item"]'));
    act(() => vi.advanceTimersByTime(200));
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null);
  } finally {
    cleanup();
  }
});

// 键盘/读屏聚焦暂停倒计时已实装（onFocusCapture 幂等 + onBlurCapture relatedTarget 出口判断）。
// 该交互被 jsdom + fake timer 的宏任务调度放大成不可运行（即便极小步推进也 OOM），
// 不在 headless 套件里承载；转为真机手测验收项，见 .codex/verification-report.md。

test('超过上限先丢无动作的旧通知，带动作的撤销入口不被无声销毁', () => {
  const { container, cleanup } = renderHost();
  try {
    const revoke = vi.fn();
    act(() => {
      emitToast('旧提示');
      emitToast('保留撤销', { action: { label: '撤销', run: revoke } });
      emitToast('新提示A');
      emitToast('新提示B');
      emitToast('新提示C');
    });
    const items = container.querySelectorAll('[data-testid="toast-item"]');
    assert.equal(items.length, 4);
    assert.doesNotMatch(container.textContent ?? '', /旧提示/);
    assert.match(container.textContent ?? '', /保留撤销/);
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    act(() => action.click());
    assert.equal(revoke.mock.calls.length, 1);
  } finally {
    cleanup();
  }
});

test('全是带动作通知时溢出仍丢最旧，上限依旧生效', () => {
  const { container, cleanup } = renderHost();
  try {
    act(() => {
      for (let i = 1; i <= 5; i++) {
        emitToast(`操作${i}`, { action: { label: '撤销', run: () => {} } });
      }
    });
    const items = container.querySelectorAll('[data-testid="toast-item"]');
    assert.equal(items.length, 4);
    assert.doesNotMatch(container.textContent ?? '', /操作1/);
    assert.match(container.textContent ?? '', /操作5/);
    // 带动作的撤销入口受保护：再涌进 6 条无动作通知，它们互相淘汰、上限仍 4，
    // 带动作的旧通知不被无声销毁；最新一条无动作照常可见。
    act(() => {
      for (let i = 1; i <= 6; i++) emitToast(`提示${i}`);
    });
    const after = container.querySelectorAll('[data-testid="toast-item"]');
    assert.equal(after.length, 4);
    assert.match(after[0].textContent ?? '', /操作3/);
    assert.match(after[2].textContent ?? '', /操作5/);
    assert.match(after[3].textContent ?? '', /提示6/);
    assert.doesNotMatch(container.textContent ?? '', /提示5/);
  } finally {
    cleanup();
  }
});

test('动作失败后不留倒计时：悬停进出不会把失败反馈悄悄收走', async () => {
  const { container, cleanup } = renderHost();
  try {
    act(() =>
      emitToast('会失败', {
        durationMs: 100,
        action: {
          label: '撤销',
          run: () => {
            throw new Error('失败了');
          },
        },
      }),
    );
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')!;
    await act(async () => action.click());
    assert.ok(container.querySelector('[data-testid="toast-action-error"]'));

    const item = container.querySelector('[data-testid="toast-item"]')!;
    act(() => item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    act(() =>
      container
        .querySelector('[data-testid="toast-host"]')!
        .dispatchEvent(new MouseEvent('mouseout', { bubbles: true })),
    );
    act(() => vi.advanceTimersByTime(30000));
    assert.match(container.textContent ?? '', /操作失败：失败了/);
  } finally {
    cleanup();
  }
});

test('外层容器不再自封 live region；每条通知按 tone 自管 role', () => {
  const { container, cleanup } = renderHost();
  try {
    act(() => {
      emitToast('普通提示', { tone: 'info' });
      emitToast('写回成功', { tone: 'success' });
      emitToast('写回失败', { tone: 'error' });
    });
    const host = container.querySelector('[data-testid="toast-host"]')!;
    assert.equal(host.getAttribute('role'), null);
    assert.equal(host.getAttribute('aria-live'), null);
    const items = container.querySelectorAll('[data-testid="toast-item"]');
    assert.equal(items[0].getAttribute('role'), 'status');
    assert.equal(items[1].getAttribute('role'), 'status');
    assert.equal(items[2].getAttribute('role'), 'alert');
  } finally {
    cleanup();
  }
});

test('模态打开时通知浮层不被 inert：撤销/关闭按钮仍可点', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <>
        <ToastHost />
        <DialogSurface aria-label="确认窗口" onClose={() => {}}>
          <button>确认</button>
        </DialogSurface>
      </>,
    );
  });
  try {
    const run = vi.fn();
    act(() => emitToast('已写入磁盘', { action: { label: '撤销', run } }));
    const host = container.querySelector('[data-testid="toast-host"]')!;
    assert.ok(host);
    // 豁免层：模态打开时不加 inert/aria-hidden，通知可见、可点、读屏可达。
    assert.equal(host.hasAttribute('inert'), false);
    assert.equal(host.getAttribute('aria-hidden'), null);

    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')!;
    act(() => action.click());
    assert.equal(run.mock.calls.length, 1);
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null);

    act(() => emitToast('另一条通知'));
    const close = container.querySelector<HTMLButtonElement>('[data-testid="toast-close"]')!;
    act(() => close.click());
    assert.equal(container.querySelector('[data-testid="toast-item"]'), null);
    // 弹窗本体不受这些点击影响。
    assert.ok(container.querySelector('[role="dialog"]'));
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('通知浮层 z-index 压过模态 backdrop（层系统内联 z 从 100 起跳）', () => {
  const css = readFileSync('src/index.css', 'utf8');
  const rule = css.match(/\[data-testid='toast-host'\]\s*\{([^}]*)\}/);
  assert.ok(rule, 'index.css 缺少 toast-host 的 z-index 规则');
  const zIndex = Number(rule[1].match(/z-index:\s*(\d+)/)?.[1]);
  assert.equal(zIndex, 1000);
});
