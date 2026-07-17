import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, vi } from 'vitest';

import { Titlebar } from '../src/components/shell/Titlebar';

vi.mock('../src/lib/tauri-env', () => ({
  isTauriRuntime: () => true,
}));

const calls: string[] = [];
let maximized = true;

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => maximized,
    unmaximize: async () => {
      calls.push('unmaximize');
      maximized = false;
    },
    startDragging: async () => {
      calls.push('startDragging');
    },
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('最大化状态下拖标题栏先还原再 startDragging（Windows 拖最大化窗口静默无效）', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => {
      root.render(
        <Titlebar
          onOpenPalette={() => undefined}
          projectOpen={false}
          rightCollapsed
          onToggleRight={() => undefined}
        />,
      );
    });
    const header = container.querySelector('[data-testid="shell-titlebar"]');
    assert.ok(header);

    calls.length = 0;
    maximized = true;
    await act(async () => {
      header.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.deepEqual(calls, ['unmaximize', 'startDragging']);

    // 非最大化：直接拖，不再调 unmaximize。
    calls.length = 0;
    await act(async () => {
      header.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.deepEqual(calls, ['startDragging']);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
