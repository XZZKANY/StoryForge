import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { ToastHost } from '../src/components/shell/ToastHost';
import { emitToast } from '../src/lib/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

test('窄屏通知栈按视口宽度收缩，避免固定宽度越过右边界', () => {
  const { container, cleanup } = renderHost();
  try {
    act(() => emitToast('窄屏也要完整显示的通知'));
    const host = container.querySelector<HTMLElement>('[data-testid="toast-host"]');
    assert.ok(host);
    assert.equal(host.classList.contains('max-w-[calc(100vw-1.5rem)]'), true);
  } finally {
    cleanup();
  }
});

test('同帧重复点击通知动作只执行一次', () => {
  const { container, cleanup } = renderHost();
  try {
    let calls = 0;
    act(() =>
      emitToast('可撤销操作', {
        action: {
          label: '撤销',
          run: () => {
            calls += 1;
          },
        },
      }),
    );
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')!;
    act(() => {
      action.click();
      action.click();
    });
    assert.equal(calls, 1);
    assert.equal(container.querySelector('[data-testid="toast-action"]') === null, true);
  } finally {
    cleanup();
  }
});

for (const asyncFailure of [false, true]) {
  test(`通知动作失败显示错误而非静默消失：异步=${asyncFailure}`, async () => {
    const { container, cleanup } = renderHost();
    try {
      const run = () => {
        if (asyncFailure) return Promise.reject(new Error('internal-sensitive-detail'));
        throw new Error('internal-sensitive-detail');
      };
      act(() => emitToast('原通知', { action: { label: '撤销', run } }));
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')!.click();
      });
      const error = container.querySelector('[role="alert"]');
      assert.ok(error);
      assert.match(error.textContent ?? '', /撤销.*未能完成.*检查当前状态/);
      assert.doesNotMatch(error.textContent ?? '', /internal-sensitive-detail/);
      assert.equal(
        container.querySelector('[data-testid="toast-action"]') === null,
        true,
        '不能自动提供可能重复副作用的重试',
      );
    } finally {
      cleanup();
    }
  });
}

test('动作去重以通知为单位，不阻止另一条通知或回调生成的新通知', () => {
  const { container, cleanup } = renderHost();
  try {
    let calls = 0;
    const run = () => {
      calls += 1;
      emitToast('操作后反馈');
    };
    act(() => {
      emitToast('第一条', { action: { label: '执行', run } });
      emitToast('第二条', { action: { label: '执行', run } });
    });
    const actions = container.querySelectorAll<HTMLButtonElement>('[data-testid="toast-action"]');
    act(() => {
      actions[0].click();
      actions[0].click();
      actions[1].click();
    });
    assert.equal(calls, 2);
    assert.equal(container.querySelectorAll('[data-testid="toast-item"]').length, 2);
    assert.match(container.textContent ?? '', /操作后反馈/);
  } finally {
    cleanup();
  }
});

for (const mode of ['pointer', 'focus']) {
  test(`通知交互期间暂停倒计时，离开后使用剩余时长：${mode}`, () => {
    const { container, cleanup } = renderHost();
    try {
      act(() =>
        emitToast('需要读完的通知', {
          durationMs: 4000,
          action: { label: '查看', run: () => undefined },
        }),
      );
      const item = container.querySelector<HTMLElement>('[data-testid="toast-item"]')!;
      const action = item.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')!;
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      act(() => {
        if (mode === 'pointer') item.dispatchEvent(new Event('pointerover', { bubbles: true }));
        else action.focus();
      });
      act(() => {
        vi.advanceTimersByTime(20000);
      });
      assert.equal(item.isConnected, true);
      act(() => {
        if (mode === 'pointer') item.dispatchEvent(new Event('pointerout', { bubbles: true }));
        else action.blur();
      });
      act(() => {
        vi.advanceTimersByTime(999);
      });
      assert.equal(item.isConnected, true);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      assert.equal(item.isConnected, false);
    } finally {
      cleanup();
    }
  });
}

test('鼠标离开但键盘仍在通知内时不能恢复计时', () => {
  const { container, cleanup } = renderHost();
  try {
    act(() =>
      emitToast('同时交互', { durationMs: 1000, action: { label: '查看', run: () => undefined } }),
    );
    const item = container.querySelector<HTMLElement>('[data-testid="toast-item"]')!;
    const action = item.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')!;
    const close = item.querySelector<HTMLButtonElement>('[data-testid="toast-close"]')!;
    act(() => {
      item.dispatchEvent(new Event('pointerover', { bubbles: true }));
      action.focus();
    });
    act(() => {
      item.dispatchEvent(new Event('pointerout', { bubbles: true }));
      close.focus();
      vi.advanceTimersByTime(10000);
    });
    assert.equal(item.isConnected, true);
    act(() => {
      close.blur();
      vi.advanceTimersByTime(1000);
    });
    assert.equal(item.isConnected, false);
  } finally {
    cleanup();
  }
});

test('通知溢出与卸载会清理计时器，暂停通知仍可手动关闭', () => {
  const { container, cleanup } = renderHost();
  try {
    act(() => {
      for (let i = 0; i < 5; i++) emitToast('通知' + i, { durationMs: 1000 });
    });
    assert.equal(vi.getTimerCount(), 4);
    const item = container.querySelector<HTMLElement>('[data-testid="toast-item"]')!;
    act(() => item.dispatchEvent(new Event('pointerover', { bubbles: true })));
    assert.equal(vi.getTimerCount(), 3);
    act(() => item.querySelector<HTMLButtonElement>('[data-testid="toast-close"]')!.click());
    assert.equal(item.isConnected, false);
    act(() => vi.advanceTimersByTime(1000));
    assert.equal(container.querySelector('[data-testid="toast-host"]') === null, true);
    act(() => emitToast('卸载前仍有计时器'));
    assert.equal(vi.getTimerCount(), 1);
  } finally {
    cleanup();
  }
  assert.equal(vi.getTimerCount(), 0);
});

for (const interaction of ['focus', 'pointer']) {
  test(`新通知到达不淘汰正在交互的旧通知：${interaction}`, () => {
    const { container, cleanup } = renderHost();
    try {
      act(() => emitToast('正在处理', { action: { label: '撤销', run: () => undefined } }));
      const first = container.querySelector<HTMLElement>('[data-testid="toast-item"]')!;
      const action = first.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')!;
      act(() => {
        if (interaction === 'focus') action.focus();
        else first.dispatchEvent(new Event('pointerover', { bubbles: true }));
      });
      act(() => {
        for (let i = 0; i < 5; i++) emitToast('后台完成' + i);
      });
      assert.equal(first.isConnected, true);
      assert.equal(container.querySelectorAll('[data-testid="toast-item"]').length, 4);
      assert.equal(container.textContent?.includes('后台完成4'), true);
      assert.equal(container.textContent?.includes('后台完成0'), false);
      if (interaction === 'focus') assert.equal(document.activeElement === action, true);
      act(() => {
        if (interaction === 'focus') action.blur();
        else first.dispatchEvent(new Event('pointerout', { bubbles: true }));
        emitToast('下一条');
      });
      assert.equal(first.isConnected, false);
    } finally {
      cleanup();
    }
  });
}
