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
  pendingRead: null as Promise<VersionState> | null,
}));

vi.mock('../src/lib/versions', () => ({
  listVersions: async () => mocked.versions,
  readVersionState: async (_project: string, entry: VersionEntry) => {
    if (mocked.pendingRead) return mocked.pendingRead;
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

function renderHistory(
  onRestore: (state: VersionState, entry: VersionEntry) => void,
  onClose: () => void = () => undefined,
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <VersionHistory
        projectPath="D:/Book"
        filePath="D:/Book/chapter.md"
        manifest={emptyManifest()}
        onRestore={onRestore}
        onCheckoutNode={() => undefined}
        onBranchFromNode={() => undefined}
        onSelectBranch={() => undefined}
        onClose={onClose}
        getCurrentContent={() => '当前正文'}
      />,
    );
  });
  return {
    container,
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
  mocked.pendingRead = null;
});

test('missing version previews deletion semantics and forwards structured state', async () => {
  const missing = entry(100, { created: true });
  mocked.versions = [missing];
  mocked.states.set(missing.path, { exists: false, content: '' });
  const restored: Array<{ state: VersionState; entry: VersionEntry }> = [];
  const view = renderHistory((state, version) => restored.push({ state, entry: version }));
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
    assert.equal(preview.getAttribute('aria-expanded'), 'false');
    assert.equal(preview.hasAttribute('aria-controls'), false);
    await act(async () => preview.click());
    assert.equal(preview.getAttribute('aria-expanded'), 'true');
    const previewId = preview.getAttribute('aria-controls');
    assert.ok(previewId);
    assert.equal(
      view.container.querySelector(`#${CSS.escape(previewId)}`)?.getAttribute('role'),
      'region',
    );
    assert.match(view.container.textContent ?? '', /恢复到此版会删除当前文件/);

    await act(async () => restore.click());
    assert.equal(restored.length, 1);
    assert.deepEqual(restored[0].state, { exists: false, content: '' });
    assert.equal(restored[0].entry.path, missing.path);
  } finally {
    view.cleanup();
  }
});

test('版本历史筛选和视图切换暴露当前按压状态', async () => {
  mocked.versions = [entry(300, { source: 'Editor' })];
  const view = renderHistory(() => undefined);
  try {
    await view.settle();
    const allFilter = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="version-filter-all"]',
    );
    const editorFilter = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="version-filter-Editor"]',
    );
    const listView = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="version-view-list"]',
    );
    const graphView = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="version-view-graph"]',
    );
    assert.equal(allFilter?.getAttribute('aria-pressed'), 'true');
    assert.equal(editorFilter?.getAttribute('aria-pressed'), 'false');
    assert.equal(listView?.getAttribute('aria-pressed'), 'true');
    assert.equal(graphView?.getAttribute('aria-pressed'), 'false');
    await act(async () => editorFilter?.click());
    await act(async () => graphView?.click());
    assert.equal(editorFilter?.getAttribute('aria-pressed'), 'true');
    assert.equal(allFilter?.getAttribute('aria-pressed'), 'false');
    assert.equal(graphView?.getAttribute('aria-pressed'), 'true');
    assert.equal(listView?.getAttribute('aria-pressed'), 'false');
  } finally {
    view.cleanup();
  }
});

test('来源筛选没有结果时给出准确空状态，而不是误报没有历史版本', async () => {
  mocked.versions = [entry(300, { source: 'Editor' })];
  const view = renderHistory(() => undefined);
  try {
    await view.settle();
    const agentFilter = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="version-filter-Agent"]',
    );
    assert.ok(agentFilter);
    await act(async () => agentFilter.click());
    const empty = view.container.querySelector<HTMLElement>('[data-testid="version-empty"]');
    assert.equal(empty?.getAttribute('role'), 'status');
    assert.match(empty?.textContent ?? '', /没有符合“Agent”筛选的版本/);
    assert.doesNotMatch(empty?.textContent ?? '', /还没有历史版本/);
  } finally {
    view.cleanup();
  }
});

test('对比当前读取期间锁定恢复，避免并发覆盖编辑器正文', async () => {
  const version = entry(400, { source: 'Editor' });
  mocked.versions = [version];
  let resolveRead!: (state: VersionState) => void;
  mocked.pendingRead = new Promise<VersionState>((resolve) => {
    resolveRead = resolve;
  });
  const view = renderHistory(() => undefined);
  try {
    await view.settle();
    const preview = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="version-preview-toggle"]',
    );
    const restore = [...view.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('恢复'),
    );
    assert.ok(preview && restore);
    act(() => preview.click());
    assert.equal(preview.disabled, true);
    assert.equal(restore.disabled, true);

    await act(async () => {
      resolveRead({ exists: true, content: '快照正文' });
      await Promise.resolve();
    });
    assert.equal(restore.disabled, false);
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

test('version history is a named region, focuses close on open, and closes on Escape', async () => {
  const onClose = vi.fn();
  const view = renderHistory(() => undefined, onClose);
  try {
    await view.settle();
    const panel = view.container.querySelector<HTMLElement>('[data-testid="version-history"]');
    assert.equal(panel?.getAttribute('role'), 'region');
    assert.equal(panel?.getAttribute('aria-labelledby'), 'version-history-title');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    assert.equal(
      document.activeElement,
      view.container.querySelector('[aria-label="关闭版本记录"]'),
    );

    await act(async () => {
      panel?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
      );
    });
    assert.equal(onClose.mock.calls.length, 0);
    const imeEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    Object.defineProperty(imeEscape, 'keyCode', { value: 229 });
    await act(async () => panel?.dispatchEvent(imeEscape));
    assert.equal(onClose.mock.calls.length, 0);
    await act(async () => {
      panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(onClose.mock.calls.length, 1);
  } finally {
    view.cleanup();
  }
});
