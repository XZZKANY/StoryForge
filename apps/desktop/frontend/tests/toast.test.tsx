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
