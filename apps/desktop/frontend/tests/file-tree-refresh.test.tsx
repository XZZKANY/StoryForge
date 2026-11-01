import assert from 'node:assert/strict';
import { act } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { StoryNavigator } from '../src/components/shell/StoryNavigator';
import {
  invalidateFileSystemCache,
  TauriFileSystem,
  type FileEntry,
} from '../src/lib/host/tauri-fs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:/连载/末世吞噬';

function entry(path: string, isDir: boolean): FileEntry {
  const name = path.split('/').pop() ?? path;
  return { name, path, isDir, size: 0, modified: 0, ...(isDir ? {} : { extension: 'md' }) };
}

const TREE: FileEntry[] = [
  entry(`${PROJECT}/正文`, true),
  entry(`${PROJECT}/正文/第001章.md`, false),
];
const WITH_OUTSIDE_FOLDER: FileEntry[] = [
  ...TREE,
  entry(`${PROJECT}/大纲`, true),
  entry(`${PROJECT}/大纲/总纲.md`, false),
];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let listDir: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  listDir = vi.spyOn(TauriFileSystem, 'listProjectDir').mockResolvedValue(TREE);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StoryNavigator projectPath={PROJECT} currentFile={null} onFileSelect={() => {}} />,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const folder = (name: string) =>
  container.querySelector<HTMLElement>(`[data-folder-path="${PROJECT}/${name}"]`);

test('在别处新建的文件夹，点「重新读取文件列表」就出现', async () => {
  assert.equal(folder('大纲'), null);
  listDir.mockResolvedValue(WITH_OUTSIDE_FOLDER);
  const refresh = container.querySelector<HTMLButtonElement>('[data-testid="file-tree-refresh"]');
  assert.ok(refresh);
  await act(async () => refresh.click());
  assert.ok(folder('大纲'));
});

test('重读期间树不换成「加载中」，折起来的文件夹仍折着', async () => {
  const toggle = folder('正文')?.querySelector<HTMLButtonElement>('button[aria-expanded]');
  assert.ok(toggle);
  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  let release!: (entries: FileEntry[]) => void;
  listDir.mockReturnValue(new Promise<FileEntry[]>((resolve) => (release = resolve)));
  const refresh = container.querySelector<HTMLButtonElement>('[data-testid="file-tree-refresh"]');
  await act(async () => refresh?.click());
  assert.equal((container.textContent ?? '').includes('加载中'), false);
  await act(async () => release(WITH_OUTSIDE_FOLDER));

  const after = folder('正文')?.querySelector<HTMLButtonElement>('button[aria-expanded]');
  assert.equal(after?.getAttribute('aria-expanded'), 'false');
  assert.ok(folder('大纲'));
});

test('切回窗口时自动重读，紧跟着的 visibilitychange 不再读第二次', async () => {
  const before = listDir.mock.calls.length;
  listDir.mockResolvedValue(WITH_OUTSIDE_FOLDER);
  await act(async () => window.dispatchEvent(new Event('focus')));
  assert.equal(listDir.mock.calls.length, before + 1);
  assert.ok(folder('大纲'));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(listDir.mock.calls.length, before + 1);
});

test('手动刷新绕过目录缓存：刚读过的列表不会被原样端回来', async () => {
  listDir.mockRestore();
  let disk = TREE;
  const previous = window.__STORYFORGE_MOCK_FS__;
  window.__STORYFORGE_MOCK_FS__ = { listDir: async () => disk };
  invalidateFileSystemCache(PROJECT);
  try {
    await act(async () => {
      root.render(
        <StoryNavigator
          key="real-cache"
          projectPath={PROJECT}
          currentFile={null}
          onFileSelect={() => {}}
        />,
      );
    });
    assert.equal(folder('大纲'), null);
    disk = WITH_OUTSIDE_FOLDER;
    const refresh = container.querySelector<HTMLButtonElement>('[data-testid="file-tree-refresh"]');
    await act(async () => refresh?.click());
    assert.ok(folder('大纲'));
  } finally {
    window.__STORYFORGE_MOCK_FS__ = previous;
    invalidateFileSystemCache(PROJECT);
  }
});

test('从最小化恢复（只有 visibilitychange）也会重读', async () => {
  const before = listDir.mock.calls.length;
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(listDir.mock.calls.length, before + 1);
});
