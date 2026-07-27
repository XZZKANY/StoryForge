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

  const button = folderRow('正文').querySelector<HTMLButtonElement>('[data-testid="tree-folder-new-file"]');
  assert.ok(button, '文件夹行缺少新建文件按钮');
  act(() => {
    button.click();
  });

  assert.deepEqual(calls, [['newFile', `${PROJECT}/正文`]]);
});

test('文件夹行内「新建文件夹」落在该文件夹下', async () => {
  const { calls, actions } = stubActions();
  await renderExplorer(actions);

  const button = folderRow('设定').querySelector<HTMLButtonElement>('[data-testid="tree-folder-new-folder"]');
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
    const button = folderRow(name).querySelector<HTMLButtonElement>('[data-testid="tree-folder-new-file"]');
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

  const button = folderRow('正文').querySelector<HTMLButtonElement>('[data-testid="tree-folder-new-file"]');
  assert.ok(button);
  act(() => {
    button.click();
  });

  // 展开态不变：新建的东西必须看得见，按钮不能顺带触发折叠。
  assert.ok(visibleFiles().includes(`${PROJECT}/正文/第001章.md`));
});

test('没有 fileActions 时不渲染新建按钮（无项目写权限的场景）', async () => {
  await renderExplorer(undefined);

  assert.equal(container.querySelectorAll('[data-testid="tree-folder-new-file"]').length, 0);
  assert.equal(container.querySelectorAll('[data-testid="tree-folder-new-folder"]').length, 0);
});
