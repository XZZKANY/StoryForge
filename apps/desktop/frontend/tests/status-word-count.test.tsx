import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test, vi } from 'vitest';

import { StatusBar } from '../src/components/shell/StatusBar';
import { emitEditorTextMetrics } from '../src/lib/assistant-events';
import { probeApiRuntimeHealth } from '../src/lib/api/runtime-health';

vi.mock('../src/lib/api/runtime-health', () => ({
  probeApiRuntimeHealth: vi.fn(),
}));

vi.mocked(probeApiRuntimeHealth).mockResolvedValue({ reachable: true } as never);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderStatusBar(projectOpen: boolean) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <StatusBar
        modelLabel=""
        theme="dark"
        projectOpen={projectOpen}
        obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
        fontMode="grid"
        onToggleObs={() => undefined}
        onToggleFont={() => undefined}
        onToggleTheme={() => undefined}
      />,
    );
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test('编辑器广播字数后状态栏显示「N 字」，有选区时显示已选', () => {
  const { container, cleanup } = renderStatusBar(true);
  try {
    assert.equal(container.querySelector('[data-testid="status-word-count"]'), null);

    act(() => {
      emitEditorTextMetrics({ filePath: '/p/第001章.md', charCount: 2048, selectionCharCount: 0 });
    });
    const counter = container.querySelector('[data-testid="status-word-count"]');
    assert.ok(counter);
    assert.match(counter.textContent ?? '', /2,048 字/);

    act(() => {
      emitEditorTextMetrics({ filePath: '/p/第001章.md', charCount: 2048, selectionCharCount: 30 });
    });
    assert.match(
      container.querySelector('[data-testid="status-word-count"]')?.textContent ?? '',
      /已选 30 \/ 2,048 字/,
    );

    // 关掉文件（filePath 为空）后字数消失，不残留旧数。
    act(() => {
      emitEditorTextMetrics({ filePath: null, charCount: 0, selectionCharCount: 0 });
    });
    assert.equal(container.querySelector('[data-testid="status-word-count"]'), null);
  } finally {
    cleanup();
  }
});
