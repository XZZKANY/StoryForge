import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import { StatusBar } from '../src/components/shell/StatusBar';
import { emitEditorTextMetrics } from '../src/lib/assistant-events';
import { probeApiRuntimeHealth } from '../src/lib/api/runtime-health';
import { invalidateFileSystemCache } from '../src/lib/tauri-fs';

vi.mock('../src/lib/api/runtime-health', () => ({
  probeApiRuntimeHealth: vi.fn(),
}));

vi.mocked(probeApiRuntimeHealth).mockResolvedValue({ reachable: true } as never);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockFsHost = { __STORYFORGE_MOCK_FS__?: unknown };

const ROOT = 'D:\\连载\\末世吞噬';

/** 只挂 fs mock 属性，不替换整个 window——替换了 React 就没法在 happy-dom 里渲染。 */
function mockManuscript(files: Array<{ relativePath: string; content: string }>) {
  (window as unknown as MockFsHost).__STORYFORGE_MOCK_FS__ = {
    listDir: () =>
      files.map(({ relativePath }) => {
        const name = relativePath.split('\\').pop() ?? relativePath;
        return {
          path: `${ROOT}\\${relativePath}`,
          name,
          isDir: false,
          extension: name.split('.').pop() ?? '',
          modified: 0,
          size: 0,
        };
      }),
    readFile: (path: string) =>
      Promise.resolve(files.find((file) => path.endsWith(file.relativePath))?.content ?? ''),
  };
}

afterEach(() => {
  Reflect.deleteProperty(window as unknown as MockFsHost, '__STORYFORGE_MOCK_FS__');
  invalidateFileSystemCache();
  localStorage.clear();
});

function renderStatusBar(projectOpen: boolean, extra: { dailyWordGoal?: number } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <StatusBar
        modelLabel=""
        projectOpen={projectOpen}
        projectPath={projectOpen ? ROOT : null}
        dailyWordGoal={extra.dailyWordGoal ?? 0}
        obs={{ error: 0, warning: 0, advisory: 0, total: 0 }}
        onToggleObs={() => undefined}
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

const metrics = (over: Partial<Parameters<typeof emitEditorTextMetrics>[0]> = {}) => ({
  filePath: `${ROOT}\\正文\\第001章.md`,
  charCount: 2048,
  selectionCharCount: 0,
  paragraphCount: 12,
  ...over,
});

test('编辑器广播字数后状态栏显示「N 字」，有选区时显示已选', () => {
  const { container, cleanup } = renderStatusBar(true);
  try {
    assert.equal(container.querySelector('[data-testid="status-word-count"]'), null);

    act(() => emitEditorTextMetrics(metrics()));
    const counter = container.querySelector('[data-testid="status-word-count"]');
    assert.ok(counter);
    assert.match(counter.textContent ?? '', /2,048 字/);

    act(() => emitEditorTextMetrics(metrics({ selectionCharCount: 30 })));
    assert.match(
      container.querySelector('[data-testid="status-word-count"]')?.textContent ?? '',
      /已选 30 \/ 2,048 字/,
    );

    // 关掉文件（filePath 为空）后字数消失，不残留旧数。
    act(() => emitEditorTextMetrics(metrics({ filePath: null, charCount: 0 })));
    assert.equal(container.querySelector('[data-testid="status-word-count"]'), null);
  } finally {
    cleanup();
  }
});

test('点字数开稿件卡：本章字数/段落来自广播，全书总数按需扫描正文目录', async () => {
  mockManuscript([
    { relativePath: '正文\\第001章.md', content: '他睁开眼。' },
    { relativePath: '正文\\第002章.md', content: '楼道里全是灰。' },
    { relativePath: '设定\\系统.md', content: '吞噬值上限一百。' },
  ]);
  const { container, cleanup } = renderStatusBar(true);
  try {
    act(() => emitEditorTextMetrics(metrics()));
    assert.equal(container.querySelector('[data-testid="manuscript-card"]'), null);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="status-word-count"]')?.click();
    });

    const card = container.querySelector('[data-testid="manuscript-card"]');
    assert.ok(card, '点字数应展开稿件卡');
    assert.equal(
      card.querySelector('[data-testid="manuscript-chapter-chars"]')?.textContent,
      '2,048 字',
    );
    // 设定/系统.md 不是正文，不该进章数与总字数（5 + 7 = 12）。
    assert.equal(
      card.querySelector('[data-testid="manuscript-total-chapters"]')?.textContent,
      '2 章',
    );
    assert.equal(
      card.querySelector('[data-testid="manuscript-total-chars"]')?.textContent,
      '12 字',
    );

    // 再点一次收起。
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="status-word-count"]')?.click();
    });
    assert.equal(container.querySelector('[data-testid="manuscript-card"]'), null);
  } finally {
    cleanup();
  }
});

test('日更目标为 0 时不画进度条，而不是画一条永远 0% 的条', async () => {
  mockManuscript([]);
  const { container, cleanup } = renderStatusBar(true, { dailyWordGoal: 0 });
  try {
    act(() => emitEditorTextMetrics(metrics()));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="status-word-count"]')?.click();
    });
    assert.ok(container.querySelector('[data-testid="manuscript-card"]'));
    assert.equal(container.querySelector('[data-testid="manuscript-goal-bar"]'), null);
  } finally {
    cleanup();
  }
});

test('设了日更目标就按今日已存字数画进度，超额封顶 100%', async () => {
  mockManuscript([]);
  localStorage.setItem(
    `storyforge:daily-progress:${ROOT}`,
    JSON.stringify({ date: localToday(), chars: 4500 }),
  );
  const { container, cleanup } = renderStatusBar(true, { dailyWordGoal: 3000 });
  try {
    act(() => emitEditorTextMetrics(metrics()));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="status-word-count"]')?.click();
    });
    const card = container.querySelector('[data-testid="manuscript-card"]');
    assert.match(
      card?.querySelector('[data-testid="manuscript-daily-chars"]')?.textContent ?? '',
      /\+4,500 字/,
    );
    assert.equal(
      card?.querySelector('[data-testid="manuscript-goal-bar"]')?.getAttribute('data-progress'),
      '100',
    );
  } finally {
    cleanup();
  }
});

function localToday(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
