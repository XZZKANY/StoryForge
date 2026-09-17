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

test('Agent 面板开关：名字稳定不随态翻转，态由 aria-expanded 告知', async () => {
  // 与 StatusBar 字数徽标同一弹层模式：title 随展开/收起翻转（给鼠标用户当前动作提示），
  // 但 aria-label 永远是「Agent 面板」，配合 aria-expanded 让屏读者拿到稳定身份 + 当前态。
  // 仅一个 title 时屏读者只能念到一个动作，分不出按下是展开还是收起。
  const render = async (rightCollapsed: boolean) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <Titlebar
          onOpenPalette={() => undefined}
          projectOpen
          rightCollapsed={rightCollapsed}
          onToggleRight={() => undefined}
        />,
      ),
    );
    return { container, root };
  };

  const expanded = await render(false);
  const expandedBtn = expanded.container.querySelector('[data-testid="titlebar-toggle-right"]');
  assert.equal(expandedBtn?.getAttribute('aria-label'), 'Agent 面板');
  assert.equal(expandedBtn?.getAttribute('aria-expanded'), 'true');
  assert.equal(expandedBtn?.getAttribute('title'), '收起 Agent 面板');
  act(() => expanded.root.unmount());
  expanded.container.remove();

  const collapsed = await render(true);
  const collapsedBtn = collapsed.container.querySelector('[data-testid="titlebar-toggle-right"]');
  assert.equal(collapsedBtn?.getAttribute('aria-label'), 'Agent 面板');
  assert.equal(collapsedBtn?.getAttribute('aria-expanded'), 'false');
  assert.equal(collapsedBtn?.getAttribute('title'), '展开 Agent 面板');
  act(() => collapsed.root.unmount());
  collapsed.container.remove();
});
