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

test('容量淘汰的 pending 通知，迟到失败不能复活或影响其它通知', async () => {
  const { container, cleanup } = renderHost();
  try {
    let reject!: (error: Error) => void;
    const run = () =>
      new Promise<void>((_resolve, no) => {
        reject = no;
      });
    act(() => emitToast('旧操作', { action: { label: '操作', run } }));
    const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    assert.ok(action);
    await act(async () => action.click());
    act(() => {
      for (let i = 0; i < 4; i++) emitToast(`新通知${i}`);
    });
    assert.equal(vi.getTimerCount(), 4);
    await act(async () => reject(new Error('旧失败')));
    assert.equal(container.querySelector('[data-testid="toast-action-error"]'), null);
    assert.equal(container.querySelectorAll('[data-testid="toast-item"]').length, 4);
    assert.doesNotMatch(container.textContent ?? '', /旧操作|旧失败/);
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
