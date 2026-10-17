/**
 * 改名 / 删除不能悄悄丢东西（作者 10-17：给有未保存改动的章节改名，改动直接没了）。
 * 页签 hook 与文件树动作按壳子里的真实接线装在一起：改名前先问未保存修改，
 * 改完页签原地换成新路径；删文件夹时里面打开的页签一起摘掉。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { isSameOrInsidePath, retargetEditorPath } from '../src/components/app/editor-tabs-state';
import { useEditorWorkspaceTabs } from '../src/components/app/useEditorWorkspaceTabs';
import { useFileTreeActions } from '../src/components/app/useFileTreeActions';
import type { AppDialogApi } from '../src/components/app/AppDialog';
import {
  REQUEST_SAVE_ACTIVE_FILE_EVENT,
  SAVE_ACTIVE_FILE_DONE_EVENT,
} from '../src/lib/assistant-events';
import { TauriFileSystem } from '../src/lib/tauri-fs';

vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    pathExists: vi.fn(async () => false),
    renamePath: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    listDir: vi.fn(async () => []),
    readProjectFile: vi.fn(async () => ''),
  },
}));
vi.mock('../src/lib/versions', () => ({ snapshotBeforeDelete: vi.fn(async () => undefined) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:\\连载\\末世吞噬';
const DIR = `${PROJECT}\\正文`;
const A = `${DIR}\\第003章.md`;
const B = `${DIR}\\第004章.md`;
const OTHER = `${PROJECT}\\灵感.md`;

const order: string[] = [];
const mockedRename = vi.mocked(TauriFileSystem.renamePath);
const mockedDelete = vi.mocked(TauriFileSystem.deletePath);

function installFakeEditor(activeFile: string) {
  const onRequest = (event: Event) => {
    const detail = (event as CustomEvent<{ filePath: string; requestId?: number }>).detail;
    const isActive = detail?.filePath === activeFile;
    if (isActive) order.push(`save:${detail.filePath}`);
    window.dispatchEvent(
      new CustomEvent(SAVE_ACTIVE_FILE_DONE_EVENT, {
        detail: {
          filePath: detail?.filePath ?? null,
          requestId: detail?.requestId,
          canClose: isActive ? () => true : undefined,
          status: isActive ? 'saved' : 'skipped',
        },
      }),
    );
  };
  window.addEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequest);
  return () => window.removeEventListener(REQUEST_SAVE_ACTIVE_FILE_EVENT, onRequest);
}

function mount(promptValue: string, pick: string | null) {
  const choose = vi.fn(async () => pick);
  const dialogs = {
    alert: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    choose,
    prompt: vi.fn(async () => promptValue),
  } as unknown as AppDialogApi;
  let tabs: ReturnType<typeof useEditorWorkspaceTabs> | null = null;
  let actions: ReturnType<typeof useFileTreeActions> | null = null;
  let current: string | null = null;
  function Probe() {
    const [currentFile, setCurrentFile] = React.useState<string | null>(null);
    current = currentFile;
    tabs = useEditorWorkspaceTabs({
      activeProject: PROJECT,
      currentFile,
      selectProject: () => {},
      selectFile: setCurrentFile,
      closeFile: () => setCurrentFile(null),
      removeProject: () => {},
      dialogs,
      onShowEditor: () => {},
    });
    actions = useFileTreeActions({
      activeProject: PROJECT,
      dialogs,
      openFile: tabs.openFile,
      dropOpenPathsUnder: tabs.dropOpenPathsUnder,
      confirmDiscardFiles: tabs.confirmDiscardFiles,
      openPaths: tabs.retainedEditorFiles,
      retargetOpenPaths: tabs.retargetOpenPaths,
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(Probe)));
  return {
    choose,
    get tabs() {
      return tabs!;
    },
    get actions() {
      return actions!;
    },
    get currentFile() {
      return current;
    },
    cleanup: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  order.length = 0;
  mockedRename.mockClear();
  mockedRename.mockImplementation(async (_root, from, to) => {
    order.push(`rename:${from}->${to}`);
  });
  mockedDelete.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

test('改名正在写的脏章节：先问「保存并重命名」，存完再改名，页签原地换成新名字', async () => {
  const dispose = installFakeEditor(A);
  const harness = mount('第003章 夜探', 'save');
  try {
    act(() => void harness.tabs.openFile(B));
    act(() => void harness.tabs.openFile(A));
    act(() => harness.tabs.handleEditorDirtyChange(A, true));

    await act(async () => harness.actions.onRename(A, false));

    const renamed = `${DIR}\\第003章 夜探.md`;
    assert.equal(harness.choose.mock.calls.length, 1);
    assert.deepEqual(order, [`save:${A}`, `rename:${A}->${renamed}`]);
    assert.deepEqual(harness.tabs.openFiles, [B, renamed], '页签留在原位，不挪到最后');
    assert.equal(harness.currentFile, renamed);
    assert.equal(harness.tabs.dirtyFiles.size, 0);
  } finally {
    harness.cleanup();
    dispose();
  }
});

test('未保存修改的确认里点「继续编辑」：不改名，修改还在', async () => {
  const dispose = installFakeEditor(A);
  const harness = mount('第003章 夜探', null);
  try {
    act(() => void harness.tabs.openFile(A));
    act(() => harness.tabs.handleEditorDirtyChange(A, true));

    await act(async () => harness.actions.onRename(A, false));

    assert.equal(mockedRename.mock.calls.length, 0);
    assert.deepEqual(harness.tabs.openFiles, [A]);
    assert.ok(harness.tabs.dirtyFiles.has(A));
  } finally {
    harness.cleanup();
    dispose();
  }
});

test('改文件夹名：里面打开着的页签都换到新文件夹下，别的页签不动', async () => {
  const harness = mount('正文（修订）', null);
  try {
    act(() => void harness.tabs.openFile(A));
    act(() => void harness.tabs.openFile(OTHER));
    act(() => void harness.tabs.openFile(B));

    await act(async () => harness.actions.onRename(DIR, true));

    const moved = `${PROJECT}\\正文（修订）`;
    assert.deepEqual(harness.tabs.openFiles, [
      `${moved}\\第003章.md`,
      OTHER,
      `${moved}\\第004章.md`,
    ]);
    assert.equal(harness.currentFile, `${moved}\\第004章.md`);
  } finally {
    harness.cleanup();
  }
});

test('删文件夹：里面打开着的页签一起关掉，不留旧路径的页签', async () => {
  const harness = mount('', null);
  try {
    act(() => void harness.tabs.openFile(A));
    act(() => void harness.tabs.openFile(OTHER));
    act(() => void harness.tabs.openFile(B));

    await act(async () => harness.actions.onDelete(DIR, true));

    assert.equal(mockedDelete.mock.calls.length, 1);
    assert.deepEqual(harness.tabs.openFiles, [OTHER]);
    assert.equal(harness.currentFile, OTHER);
  } finally {
    harness.cleanup();
  }
});

test('路径归属两种分隔符都认，同名前缀的兄弟目录不算在里面', () => {
  assert.equal(isSameOrInsidePath(`D:/连载/末世吞噬/正文/第003章.md`, DIR), true);
  assert.equal(isSameOrInsidePath(`${PROJECT}\\正文二\\第003章.md`, DIR), false);
  assert.equal(retargetEditorPath(A, DIR, `${PROJECT}\\定稿`), `${PROJECT}\\定稿\\第003章.md`);
  assert.equal(retargetEditorPath(OTHER, DIR, `${PROJECT}\\定稿`), OTHER);
});
