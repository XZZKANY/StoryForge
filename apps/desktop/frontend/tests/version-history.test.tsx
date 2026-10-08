import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, test, vi } from 'vitest';

import { emptyManifest } from '../src/lib/branches';
import type { VersionEntry, VersionState } from '../src/lib/versions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocked = vi.hoisted(() => ({
  versions: [] as VersionEntry[],
  states: new Map<string, VersionState>(),
  list: null as null | ((project: string | null, file: string) => Promise<VersionEntry[]>),
}));

vi.mock('../src/lib/versions', () => ({
  listVersions: async (project: string | null, file: string) =>
    mocked.list ? mocked.list(project, file) : mocked.versions,
  readVersionState: async (_project: string, entry: VersionEntry) => {
    if (entry.unavailableReason) throw new Error(entry.unavailableReason);
    return mocked.states.get(entry.path) ?? { exists: true, content: '' };
  },
}));

import { VersionHistory } from '../src/components/editor/VersionHistory';

function entry(timestamp: number, extra: Partial<VersionEntry> = {}): VersionEntry {
  const path = `D:/Book/.storyforge/versions/chapter/${timestamp}.meta.json`;
  return {
    path,
    contentRef: { kind: 'shadow-tree', treeHash: 'a'.repeat(40), file: 'chapter.md' },
    timestamp,
    file: 'chapter.md',
    ...extra,
  };
}

function renderHistory(onRestore: (entry: VersionEntry) => void | Promise<void>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const render = (filePath = 'D:/Book/chapter.md') => {
    root.render(
      <VersionHistory
        projectPath="D:/Book"
        filePath={filePath}
        manifest={emptyManifest()}
        onRestore={onRestore}
        onCheckoutNode={() => undefined}
        onBranchFromNode={() => undefined}
        onSelectBranch={() => undefined}
        onClose={() => undefined}
        getCurrentContent={() => '当前正文'}
      />,
    );
  };
  act(() => render());
  return {
    container,
    navigate(filePath: string) {
      act(() => render(filePath));
    },
    async settle() {
      await act(async () => {
        await Promise.resolve();
      });
    },
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  mocked.versions = [];
  mocked.states.clear();
  mocked.list = null;
});

test('missing version previews deletion semantics and transfers the entry before parent-owned state IO', async () => {
  const missing = entry(100, { created: true });
  mocked.versions = [missing];
  mocked.states.set(missing.path, { exists: false, content: '' });
  const restored: VersionEntry[] = [];
  const view = renderHistory((version) => restored.push(version));
  try {
    await view.settle();
    const restore = [...view.container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('恢复为不存在'),
    );
    assert.ok(restore, 'missing version must use deletion wording');

    const preview = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="version-preview-toggle"]',
    );
    assert.ok(preview);
    await act(async () => preview.click());
    assert.match(view.container.textContent ?? '', /恢复到此版会删除当前文件/);

    await act(async () => restore.click());
    assert.equal(restored.length, 1);
    assert.equal(restored[0].created, true);
    assert.equal(restored[0].path, missing.path);
  } finally {
    view.cleanup();
  }
});

test('版本条目走 ul/li 列表语义，读屏可报「列表，共 N 项」', async () => {
  mocked.versions = [entry(100), entry(200)];
  const view = renderHistory(() => undefined);
  try {
    await view.settle();
    const list = view.container.querySelector('ul[role="list"]');
    assert.ok(list, '版本条目应渲染为列表');
    const items = list.querySelectorAll(':scope > li[data-testid="version-entry"]');
    assert.equal(items.length, 2);
  } finally {
    view.cleanup();
  }
});

test('空态居中图标 + 说明文字，LiveStatus 分相位播报读取中 → 完成', async () => {
  mocked.versions = [];
  const view = renderHistory(() => undefined);
  try {
    // 读取中相位：恒定一句，且与空态同款居中图标结构。
    const live = () => view.container.querySelector('[data-testid="version-history-live"]');
    assert.equal(live()?.getAttribute('role'), 'status');
    assert.match(live()?.textContent ?? '', /正在读取版本历史/);
    assert.ok(view.container.querySelector('[data-testid="version-history-loading"]'));
    assert.match(view.container.textContent ?? '', /正在读取版本历史…/);

    await view.settle();
    // 完成相位：带条数；可见空态带图标、说明文字不裸奔。
    assert.match(live()?.textContent ?? '', /读取完成，共 0 条/);
    const empty = view.container.querySelector('[data-testid="version-history-empty"]');
    assert.ok(empty);
    assert.ok(empty.querySelector('svg'), '空态应有图标');
    assert.match(empty.textContent ?? '', /还没有历史版本。保存修改后会自动记录。/);
  } finally {
    view.cleanup();
  }
});

test('D1 视觉对齐：不再残留旧 accent token，主操作走 agent 系', async () => {
  mocked.versions = [entry(100)];
  const view = renderHistory(() => undefined);
  try {
    await view.settle();
    const rootEl = view.container.querySelector('[data-testid="version-history"]');
    assert.ok(rootEl);
    const offenders = rootEl.querySelectorAll('.bg-accent, .text-accent-foreground');
    assert.equal(offenders.length, 0, '版本历史不应再使用旧 bg-accent / text-accent-foreground');
    // 选中态与主操作按钮已是 agent 系。
    assert.ok(
      rootEl.querySelector('[data-testid="version-view-list"]')?.classList.contains('bg-agent/10'),
    );
    const restore = [...rootEl.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('恢复'),
    );
    assert.ok(restore?.classList.contains('bg-agent'));
    // 关闭按钮用 shell-icons 矢量图标（svg 由图标库渲染，不再是手写 path）。
    const close = rootEl.querySelector('button[aria-label="关闭版本历史"]');
    assert.ok(close?.querySelector('svg'), '关闭按钮应渲染 shell-icons 图标');
  } finally {
    view.cleanup();
  }
});

test('missing tree/ref stays visible with an explicit reason and disabled actions', async () => {
  const unavailable = entry(200, {
    unavailableReason: '影子 Git tree 或作品版本保活 ref 已丢失',
  });
  mocked.versions = [unavailable];
  const view = renderHistory(() => undefined);
  try {
    await view.settle();
    assert.match(view.container.textContent ?? '', /保活 ref 已丢失/);
    assert.equal(
      view.container.querySelector<HTMLButtonElement>('[data-testid="version-preview-toggle"]')
        ?.disabled,
      true,
    );
    const restore = [...view.container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('恢复'),
    );
    assert.equal(restore?.disabled, true);
  } finally {
    view.cleanup();
  }
});

test('换文件后立即隐藏旧版本行，不等新文件读取结束', async () => {
  const original = entry(100, { summary: 'A旧版本' });
  mocked.versions = [original];
  const view = renderHistory(() => undefined);
  try {
    await view.settle();
    assert.match(view.container.textContent ?? '', /A旧版本/);
    let finish!: (entries: VersionEntry[]) => void;
    mocked.list = async () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    view.navigate('D:/Book/other.md');
    assert.equal(view.container.querySelectorAll('[data-testid="version-entry"]').length, 0);
    assert.doesNotMatch(view.container.textContent ?? '', /A旧版本/);
    const other = entry(200, {
      path: 'D:/Book/.storyforge/versions/other/200.meta.json',
      file: 'other.md',
      summary: 'B旧版本',
    });
    await act(async () => finish([other]));
    assert.match(view.container.textContent ?? '', /B旧版本/);
  } finally {
    view.cleanup();
  }
});

test('旧文件恢复迟到失败不能清除新文件的忙状态或错误展示', async () => {
  const original = entry(100);
  mocked.versions = [original];
  let failOld!: (reason: Error) => void;
  let finishNew!: () => void;
  const view = renderHistory((version) =>
    version.path === original.path
      ? new Promise<void>((_resolve, reject) => {
          failOld = reject;
        })
      : new Promise<void>((resolve) => {
          finishNew = resolve;
        }),
  );
  const restore = () =>
    [...view.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '恢复' || b.textContent === '恢复中…',
    )!;
  try {
    await view.settle();
    await act(async () => restore().click());
    const other = entry(200, {
      path: 'D:/Book/.storyforge/versions/other/200.meta.json',
      file: 'other.md',
    });
    mocked.versions = [other];
    view.navigate('D:/Book/other.md');
    await view.settle();
    await act(async () => restore().click());
    await act(async () => failOld(new Error('A旧错误')));
    assert.equal(restore().getAttribute('aria-busy'), 'true');
    assert.doesNotMatch(view.container.textContent ?? '', /A旧错误/);
    await act(async () => finishNew());
    assert.equal(restore().disabled, false);
  } finally {
    view.cleanup();
  }
});
