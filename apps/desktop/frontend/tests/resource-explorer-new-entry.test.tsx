import assert from 'node:assert/strict';
import { act } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { ResourceExplorer } from '../src/components/ResourceExplorer';
import { TauriFileSystem, type FileEntry } from '../src/lib/tauri-fs';
import type { FileTreeActions } from '../src/components/app/useFileTreeActions';

const PROJECT = 'D:/连载/末世吞噬';

function entry(path: string, isDir: boolean): FileEntry {
  const name = path.split('/').pop() ?? path;
  // 资源树按扩展名过滤（isVisibleProjectTreeEntry），文件必须带 extension 才会渲染。
  return { name, path, isDir, size: 0, modified: 0, ...(isDir ? {} : { extension: 'md' }) };
}

const TREE: FileEntry[] = [
  entry(`${PROJECT}/正文`, true),
  entry(`${PROJECT}/正文/第001章.md`, false),
  entry(`${PROJECT}/设定`, true),
  entry(`${PROJECT}/设定/人物.md`, false),
];

function stubActions() {
  const calls: Array<[string, string]> = [];
  const actions: FileTreeActions = {
    onNewFile: async (dir) => {
      calls.push(['newFile', dir]);
    },
    onNewFolder: async (dir) => {
      calls.push(['newFolder', dir]);
    },
    onRename: async () => {},
    onDelete: async () => {},
  };
  return { calls, actions };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.spyOn(TauriFileSystem, 'listDir').mockResolvedValue(TREE);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderExplorer(actions: FileTreeActions | undefined) {
  await act(async () => {
    root.render(
      <ResourceExplorer
        projectPath={PROJECT}
        currentFile={null}
        onFileSelect={() => {}}
        fileActions={actions}
      />,
    );
  });
}

function folderRow(name: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-folder-path="${PROJECT}/${name}"]`);
  assert.ok(row, `未找到文件夹行：${name}`);
  return row;
}

test('文件夹行内「新建文件」落在该文件夹下，而不是项目根', async () => {
  const { calls, actions } = stubActions();
  await renderExplorer(actions);

  const button = folderRow('正文').querySelector<HTMLButtonElement>(
    '[data-testid="tree-folder-new-file"]',
  );
  assert.ok(button, '文件夹行缺少新建文件按钮');
  act(() => {
    button.click();
  });

  assert.deepEqual(calls, [['newFile', `${PROJECT}/正文`]]);
});

test('文件夹行内「新建文件夹」落在该文件夹下', async () => {
  const { calls, actions } = stubActions();
  await renderExplorer(actions);

  const button = folderRow('设定').querySelector<HTMLButtonElement>(
    '[data-testid="tree-folder-new-folder"]',
  );
  assert.ok(button, '文件夹行缺少新建文件夹按钮');
  act(() => {
    button.click();
  });

  assert.deepEqual(calls, [['newFolder', `${PROJECT}/设定`]]);
});

test('每个文件夹行各自带按钮，互不串目录', async () => {
  const { calls, actions } = stubActions();
  await renderExplorer(actions);

  for (const name of ['正文', '设定']) {
    const button = folderRow(name).querySelector<HTMLButtonElement>(
      '[data-testid="tree-folder-new-file"]',
    );
    assert.ok(button);
    act(() => {
      button.click();
    });
  }

  assert.deepEqual(calls, [
    ['newFile', `${PROJECT}/正文`],
    ['newFile', `${PROJECT}/设定`],
  ]);
});

test('点新建按钮不会把文件夹折叠起来', async () => {
  const { actions } = stubActions();
  await renderExplorer(actions);

  const visibleFiles = () =>
    Array.from(container.querySelectorAll('[data-testid="file-item"]')).map((node) =>
      node.getAttribute('data-file-path'),
    );
  assert.ok(visibleFiles().includes(`${PROJECT}/正文/第001章.md`));

  const button = folderRow('正文').querySelector<HTMLButtonElement>(
    '[data-testid="tree-folder-new-file"]',
  );
  assert.ok(button);
  act(() => {
    button.click();
  });

  // 展开态不变：新建的东西必须看得见，按钮不能顺带触发折叠。
  assert.ok(visibleFiles().includes(`${PROJECT}/正文/第001章.md`));
});

test('文件夹按钮关联稳定子树分组并用 hidden 表达折叠', async () => {
  await renderExplorer(undefined);

  const row = folderRow('正文');
  const toggle = row.querySelector<HTMLButtonElement>('button[aria-controls]');
  assert.ok(toggle);
  const childrenId = toggle.getAttribute('aria-controls');
  assert.ok(childrenId);
  const children = container.querySelector<HTMLElement>(`#${CSS.escape(childrenId)}`);
  assert.ok(children);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(children.getAttribute('role'), 'group');
  assert.equal(children.hidden, false);

  act(() => toggle.click());
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(children.hidden, true);
  assert.ok(container.querySelector(`[data-file-path="${PROJECT}/正文/第001章.md"]`));
});

test('资源树提供层级语义并支持方向键浏览', async () => {
  await renderExplorer(undefined);

  const tree = container.querySelector<HTMLElement>('[role="tree"]');
  assert.ok(tree);
  assert.equal(tree.getAttribute('aria-label'), '项目文件树');

  const folder = folderRow('正文').querySelector<HTMLElement>('[role="treeitem"]');
  const file = container.querySelector<HTMLElement>(
    `[data-file-path="${PROJECT}/正文/第001章.md"]`,
  );
  assert.ok(folder);
  assert.ok(file);
  assert.equal(folder.getAttribute('aria-level'), '1');
  assert.equal(file.getAttribute('aria-level'), '2');

  act(() => {
    folder.focus();
    folder.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  assert.equal(document.activeElement, file);

  act(() => {
    file.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  });
  assert.equal(document.activeElement, folder);

  act(() => {
    folder.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  });
  assert.equal(folder.getAttribute('aria-expanded'), 'false');
  act(() => {
    folder.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  assert.equal(folder.getAttribute('aria-expanded'), 'true');
});

test('资源树使用 roving tabindex，Tab 只进入当前节点', async () => {
  await renderExplorer(undefined);

  const items = () =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter(
      (item) => !item.closest('[hidden]'),
    );
  const folder = folderRow('正文').querySelector<HTMLElement>('[role="treeitem"]');
  const file = container.querySelector<HTMLElement>(
    `[data-file-path="${PROJECT}/正文/第001章.md"]`,
  );
  assert.ok(folder);
  assert.ok(file);
  assert.equal(items().filter((item) => item.tabIndex === 0).length, 1);
  assert.equal(items()[0]?.tabIndex, 0);
  assert.equal(file.tabIndex, -1);

  act(() => {
    folder.focus();
    folder.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  assert.equal(document.activeElement, file);
  assert.equal(folder.tabIndex, -1);
  assert.equal(file.tabIndex, 0);
});

test('没有 fileActions 时不渲染新建按钮（无项目写权限的场景）', async () => {
  await renderExplorer(undefined);

  assert.equal(container.querySelectorAll('[data-testid="tree-folder-new-file"]').length, 0);
  assert.equal(container.querySelectorAll('[data-testid="tree-folder-new-folder"]').length, 0);
});

test('文件树加载中状态向辅助技术播报忙碌状态', async () => {
  let resolveList: ((entries: FileEntry[]) => void) | undefined;
  const pending = new Promise<FileEntry[]>((resolve) => {
    resolveList = resolve;
  });
  vi.mocked(TauriFileSystem.listDir).mockReturnValueOnce(pending);

  act(() => {
    root.render(
      <ResourceExplorer projectPath={PROJECT} currentFile={null} onFileSelect={() => {}} />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });

  const loading = container.querySelector<HTMLElement>('[role="status"]');
  assert.ok(loading);
  assert.equal(loading.getAttribute('aria-live'), 'polite');
  assert.equal(loading.getAttribute('aria-busy'), 'true');
  assert.match(loading.textContent ?? '', /加载中/);

  resolveList?.(TREE);
  await act(async () => {
    await pending;
  });
});

test('文件树失败重试后焦点落到加载状态而不是 body', async () => {
  let rejectList: ((error: Error) => void) | undefined;
  const failed = new Promise<FileEntry[]>((_, reject) => {
    rejectList = reject;
  });
  vi.mocked(TauriFileSystem.listDir).mockReturnValueOnce(failed);
  void failed.catch(() => undefined);

  act(() => {
    root.render(
      <ResourceExplorer projectPath={PROJECT} currentFile={null} onFileSelect={() => {}} />,
    );
  });
  rejectList?.(new Error('permission denied'));
  await act(async () => {
    await failed.catch(() => undefined);
  });

  const retry = container.querySelector<HTMLButtonElement>('[data-testid="panel-error-retry"]');
  assert.ok(retry);
  retry.focus();

  let resolveRetry: ((entries: FileEntry[]) => void) | undefined;
  const retryPromise = new Promise<FileEntry[]>((resolve) => {
    resolveRetry = resolve;
  });
  vi.mocked(TauriFileSystem.listDir).mockReturnValueOnce(retryPromise);
  act(() => retry.click());
  await act(async () => {
    await Promise.resolve();
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  assert.equal(document.activeElement?.getAttribute('role'), 'status');
  assert.equal(document.activeElement?.getAttribute('aria-busy'), 'true');

  resolveRetry?.(TREE);
  await act(async () => {
    await retryPromise;
  });
});
