import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, test, vi } from 'vitest';

import { Titlebar } from '../src/components/shell/Titlebar';

vi.mock('../src/lib/tauri-env', () => ({
  isTauriRuntime: () => true,
}));

const calls: string[] = [];
let maximized = true;
const resizeListeners = new Set<() => void>();
const unlisten = vi.fn();
let resolveSubscription: (() => void) | undefined;
let deferSubscription = false;

beforeEach(() => {
  calls.length = 0;
  maximized = true;
  resizeListeners.clear();
  unlisten.mockClear();
  deferSubscription = false;
  resolveSubscription = undefined;
});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => maximized,
    onResized: async (listener: () => void) => {
      if (deferSubscription) {
        await new Promise<void>((resolve) => {
          resolveSubscription = resolve;
        });
      }
      resizeListeners.add(listener);
      return () => {
        resizeListeners.delete(listener);
        unlisten();
      };
    },
    unmaximize: async () => {
      calls.push('unmaximize');
      maximized = false;
    },
    startDragging: async () => {
      calls.push('startDragging');
    },
    minimize: async () => {},
    toggleMaximize: async () => {
      calls.push('toggleMaximize');
      maximized = !maximized;
      resizeListeners.forEach((listener) => listener());
    },
    close: async () => {},
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('最大化状态下拖标题栏先还原再 startDragging（Windows 拖最大化窗口静默无效）', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
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

test('双击标题栏按钮和图标不触发窗口动作，空白区域仍可最大化', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <Titlebar
          onOpenPalette={() => undefined}
          projectOpen
          rightCollapsed
          onToggleRight={() => undefined}
        />,
      ),
    );
    const header = container.querySelector('[data-testid="shell-titlebar"]');
    assert.ok(header);
    for (const target of container.querySelectorAll('button, button svg, button path')) {
      await act(async () => {
        target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
        target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });
    }
    assert.deepEqual(calls, []);
    await act(async () => header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    assert.deepEqual(calls, ['toggleMaximize']);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('窗口状态变化同步最大化和还原提示，卸载时移除原生监听', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <Titlebar
          onOpenPalette={() => undefined}
          projectOpen
          rightCollapsed
          onToggleRight={() => undefined}
        />,
      ),
    );
    const restoreButton = container.querySelector<HTMLButtonElement>('button[title="还原"]');
    assert.ok(restoreButton, '初始原生窗口已最大化，应显示还原');
    await act(async () => restoreButton.click());
    assert.ok(container.querySelector('button[title="最大化"]'));
    await act(async () => {
      maximized = true;
      resizeListeners.forEach((listener) => listener());
    });
    assert.ok(container.querySelector('button[title="还原"]'), '系统触发的最大化同样同步');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
  assert.equal(resizeListeners.size, 0);
  assert.equal(unlisten.mock.calls.length, 1);
});

test('在原生监听注册完成前卸载也会清理监听', async () => {
  deferSubscription = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <Titlebar
        onOpenPalette={() => undefined}
        projectOpen={false}
        rightCollapsed
        onToggleRight={() => undefined}
      />,
    ),
  );
  assert.ok(resolveSubscription);
  act(() => root.unmount());
  container.remove();
  await act(async () => resolveSubscription?.());
  assert.equal(resizeListeners.size, 0);
  assert.equal(unlisten.mock.calls.length, 1);
});

test('窄视口标题栏让出搜索入口空间，品牌与窗口控件仍可见', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <Titlebar
          onOpenPalette={() => undefined}
          projectOpen
          rightCollapsed
          onToggleRight={() => undefined}
        />,
      ),
    );
    const header = container.querySelector('[data-testid="shell-titlebar"]');
    assert.ok(header);
    const [brand, search, controls] = Array.from(header.children) as HTMLElement[];
    assert.match(brand.className, /max-\[719px\]:min-w-0/);
    assert.match(brand.className, /max-\[719px\]:flex-1/);
    assert.match(search.className, /max-\[719px\]:w-8/);
    assert.match(search.className, /max-\[719px\]:max-w-none/);
    assert.equal(search.getAttribute('aria-label'), '搜索文件 · Ctrl+P');
    assert.match((search.querySelector('span') as HTMLElement).className, /max-\[719px\]:hidden/);
    assert.match((search.querySelector('kbd') as HTMLElement).className, /max-\[719px\]:hidden/);
    assert.match(controls.className, /max-\[719px\]:min-w-0/);
    assert.match(
      (brand.querySelector('span:last-child') as HTMLElement).className,
      /max-\[359px\]:hidden/,
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
