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
}));

vi.mock('../src/lib/versions', () => ({
  listVersions: async () => mocked.versions,
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

function renderHistory(onRestore: (state: VersionState, entry: VersionEntry) => void) {
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
        onClose={() => undefined}
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
    await act(async () => preview.click());
    assert.match(view.container.textContent ?? '', /恢复到此版会删除当前文件/);

    await act(async () => restore.click());
    assert.equal(restored.length, 1);
    assert.deepEqual(restored[0].state, { exists: false, content: '' });
    assert.equal(restored[0].entry.path, missing.path);
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
