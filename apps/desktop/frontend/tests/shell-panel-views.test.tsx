/**
 * useShellState 左栏双视图语义（#13 观测镜从右栏迁到左栏）：
 * toggleObservatory 切到左栏观测镜视图（折叠时先展开）；再点观测镜图标收起；
 * showExplorerView 回资源管理器。右栏只有对话，不再有 rightView。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { test } from 'vitest';

import { useShellState } from '../src/components/shell/useShellState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ShellApi = ReturnType<typeof useShellState>;

let latest: ShellApi | null = null;

function Harness() {
  latest = useShellState();
  return null;
}

async function withShell(run: () => Promise<void>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await run();
  } finally {
    act(() => root.unmount());
    container.remove();
    latest = null;
  }
}

test('起始为资源管理器视图；toggleObservatory 切到左栏观测镜', async () => {
  await withShell(async () => {
    assert.equal(latest!.view, 'explorer');

    await act(async () => latest!.toggleObservatory());
    assert.equal(latest!.view, 'observatory');
    assert.equal(latest!.sidebarHidden, false);
  });
});

test('左栏折叠时 toggleObservatory 先展开并直落观测镜', async () => {
  await withShell(async () => {
    await act(async () => latest!.toggleSidebar());
    assert.equal(latest!.sidebarHidden, true);

    await act(async () => latest!.toggleObservatory());
    assert.equal(latest!.view, 'observatory');
    assert.equal(latest!.sidebarHidden, false);
  });
});

test('已在观测镜且面板可见时再点即收起（VS Code 语义）', async () => {
  await withShell(async () => {
    await act(async () => latest!.toggleObservatory());
    assert.equal(latest!.view, 'observatory');

    await act(async () => latest!.toggleObservatory());
    assert.equal(latest!.sidebarHidden, true);
  });
});

test('showExplorerView 从观测镜回资源管理器并保证面板可见', async () => {
  await withShell(async () => {
    await act(async () => latest!.toggleObservatory());
    assert.equal(latest!.view, 'observatory');

    await act(async () => latest!.showExplorerView());
    assert.equal(latest!.view, 'explorer');
    assert.equal(latest!.sidebarHidden, false);
  });
});

test('右栏折叠语义不受影响（editor 隐藏右栏，showRight 落回 balanced）', async () => {
  await withShell(async () => {
    await act(async () => latest!.setLayoutMode('editor'));
    assert.equal(latest!.rightCollapsed, true);

    await act(async () => latest!.showRight());
    assert.equal(latest!.layoutMode, 'balanced');
    assert.equal(latest!.rightCollapsed, false);
  });
});
