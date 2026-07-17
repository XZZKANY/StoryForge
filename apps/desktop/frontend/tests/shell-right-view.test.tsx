/**
 * useShellState 右栏双视图语义：右栏隐藏时 Ctrl+4 先展开并直落观测镜；
 * 可见时在对话↔观测镜间切换；showChatView 回对话。
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

test('右栏隐藏时 toggleObservatory 先展开并直落观测镜', async () => {
  await withShell(async () => {
    await act(async () => latest!.setLayoutMode('editor'));
    assert.equal(latest!.rightCollapsed, true);

    await act(async () => latest!.toggleObservatory());
    assert.equal(latest!.layoutMode, 'balanced');
    assert.equal(latest!.rightView, 'observatory');
  });
});

test('右栏可见时 toggleObservatory 在对话与观测镜间往返', async () => {
  await withShell(async () => {
    assert.equal(latest!.rightView, 'chat');

    await act(async () => latest!.toggleObservatory());
    assert.equal(latest!.rightView, 'observatory');
    assert.equal(latest!.layoutMode, 'balanced');

    await act(async () => latest!.toggleObservatory());
    assert.equal(latest!.rightView, 'chat');
  });
});

test('showChatView 从观测镜回对话', async () => {
  await withShell(async () => {
    await act(async () => latest!.toggleObservatory());
    assert.equal(latest!.rightView, 'observatory');

    await act(async () => latest!.showChatView());
    assert.equal(latest!.rightView, 'chat');
  });
});
