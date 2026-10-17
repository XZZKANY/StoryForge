/**
 * 删除可撤销（作者 10-17 选「应用内撤销」）：删前留快照、删完右下角给「撤销」；
 * 快照留不下就不删；图片等读不成文本的文件，确认里如实说删了找不回。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { AppDialogApi } from '../src/components/app/AppDialog';
import { useFileTreeActions, type FileTreeActions } from '../src/components/app/useFileTreeActions';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { emitToast, type ToastAction } from '../src/lib/toast';
import { snapshotBeforeDelete } from '../src/lib/versions';

vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    pathExists: vi.fn(async () => false),
    listDir: vi.fn(async () => []),
    readProjectFile: vi.fn(async () => ''),
    deletePath: vi.fn(async () => undefined),
    createDir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  },
}));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));
vi.mock('../src/lib/versions', () => ({ snapshotBeforeDelete: vi.fn(async () => undefined) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:\\连载\\末世吞噬';
const CHAPTER = `${PROJECT}\\正文\\第006章.md`;
const fsMock = vi.mocked(TauriFileSystem);
const toast = vi.mocked(emitToast);
const snapshot = vi.mocked(snapshotBeforeDelete);
const order: string[] = [];

function mount() {
  const confirm = vi.fn(async (_options: { message: string }) => true);
  const alert = vi.fn(async (_options: { title: string }) => {});
  const dialogs = { alert, confirm, choose: vi.fn(), prompt: vi.fn() } as unknown as AppDialogApi;
  let actions: FileTreeActions | null = null;
  function Probe() {
    actions = useFileTreeActions({
      activeProject: PROJECT,
      dialogs,
      openFile: async () => {},
      dropOpenPathsUnder: () => {},
      confirmDiscardFiles: async () => true,
      openPaths: [],
      retargetOpenPaths: () => {},
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(Probe)));
  return { confirm, alert, actions: () => actions!, cleanup: () => act(() => root.unmount()) };
}

function undoAction(): ToastAction {
  const call = toast.mock.calls.find(([, options]) => options?.action);
  assert.ok(call, '删完要给带「撤销」的通知');
  return call[1]!.action!;
}

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  fsMock.readProjectFile.mockImplementation(async () => '# 第006章\n\n他推开门。\n');
  fsMock.pathExists.mockImplementation(async () => false);
  snapshot.mockImplementation(async (_project, files) => {
    order.push(`snapshot:${files.join(',')}`);
  });
  fsMock.deletePath.mockImplementation(async (_project, path) => {
    order.push(`delete:${path}`);
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

test('删一章：先留快照再删，删完给「撤销」，点了按原路径写回原文', async () => {
  const harness = mount();
  try {
    await act(async () => harness.actions().onDelete(CHAPTER, false));

    assert.match(harness.confirm.mock.calls[0]![0].message, /删前会留一份快照，删完可以撤销/);
    assert.doesNotMatch(harness.confirm.mock.calls[0]![0].message, /无法撤销/);
    assert.deepEqual(order, [`snapshot:${CHAPTER}`, `delete:${CHAPTER}`]);

    await act(async () => undoAction().run());
    assert.deepEqual(fsMock.writeFile.mock.calls[0], [
      PROJECT,
      CHAPTER,
      '# 第006章\n\n他推开门。\n',
    ]);
    assert.ok(toast.mock.calls.some(([message]) => message === '已恢复「第006章.md」'));
  } finally {
    harness.cleanup();
  }
});

test('快照留不下就不删，文件原样在', async () => {
  snapshot.mockRejectedValueOnce(new Error('影子 Git 不可用'));
  const harness = mount();
  try {
    await act(async () => harness.actions().onDelete(CHAPTER, false));
    assert.equal(fsMock.deletePath.mock.calls.length, 0);
    assert.equal(harness.alert.mock.calls[0]![0].title, '没能留下删除前快照，已取消删除');
  } finally {
    harness.cleanup();
  }
});

test('删文件夹：图片等读不了的如实说找不回；应用数据不另记版本；撤销把目录和文本都建回来', async () => {
  const folder = `${PROJECT}\\.资料`;
  fsMock.listDir.mockResolvedValueOnce([
    { name: '图', path: `${folder}\\图`, isDir: true },
    { name: '设定.md', path: `${folder}\\设定.md`, isDir: false },
    { name: '封面.jpg', path: `${folder}\\图\\封面.jpg`, isDir: false },
  ] as never);
  fsMock.readProjectFile.mockImplementation(async (_project, path) => {
    if (path.endsWith('.jpg')) throw new Error('stream did not contain valid UTF-8');
    return '设定正文';
  });
  const harness = mount();
  try {
    await act(async () => harness.actions().onDelete(folder, true));
    assert.match(
      harness.confirm.mock.calls[0]![0].message,
      /1 个文件（图片或过大的文件）留不了快照/,
    );
    assert.deepEqual(order, [`snapshot:${folder}\\设定.md`, `delete:${folder}`]);

    await act(async () => undoAction().run());
    assert.deepEqual(
      fsMock.createDir.mock.calls.map((call) => call[1]),
      [folder, `${folder}\\图`],
    );
    assert.deepEqual(fsMock.writeFile.mock.calls[0], [PROJECT, `${folder}\\设定.md`, '设定正文']);
  } finally {
    harness.cleanup();
  }
});

test('删 .storyforge 里的东西不往版本记录里再记一条', async () => {
  const appData = `${PROJECT}\\.storyforge\\canon\\canon.json`;
  const harness = mount();
  try {
    await act(async () => harness.actions().onDelete(appData, false));
    assert.deepEqual(snapshot.mock.calls[0]?.[1], []);
    assert.equal(fsMock.deletePath.mock.calls.length, 1);
  } finally {
    harness.cleanup();
  }
});

test('撤销时原路径已经有同名新文件：不覆盖，告诉作者去版本记录找', async () => {
  const harness = mount();
  try {
    await act(async () => harness.actions().onDelete(CHAPTER, false));
    fsMock.pathExists.mockImplementation(async () => true);
    await act(async () => undoAction().run());
    assert.equal(fsMock.writeFile.mock.calls.length, 0);
    assert.ok(toast.mock.calls.some(([message]) => /没有覆盖/.test(message)));
  } finally {
    harness.cleanup();
  }
});
