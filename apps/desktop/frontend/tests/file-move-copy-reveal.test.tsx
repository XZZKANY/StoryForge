/**
 * 文件树右键里的「移动到…」「复制一份」「在资源管理器中显示」：
 * 移动走改名同一条路（先问未保存、版本记录与页签跟着走）且可撤销；
 * 副本落在正文里会被当成一章，复制前要说清楚；显示只交给宿主，失败要报。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { AppDialogApi } from '../src/components/app/AppDialog';
import { useFileTreeActions, type FileTreeActions } from '../src/components/app/useFileTreeActions';
import { countsAsChapter } from '../src/lib/api/manuscript-paths';
import { copyName } from '../src/lib/fs-path-ops';
import { TauriFileSystem, type FileEntry } from '../src/lib/tauri-fs';
import { emitToast, type ToastAction } from '../src/lib/toast';
import { recordRenameLineage } from '../src/lib/versions';

vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    projectPathExists: vi.fn(async () => false),
    listProjectDir: vi.fn(async () => []),
    readProjectFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => undefined),
    writeFileIfUnchanged: vi.fn(async () => undefined),
    renamePath: vi.fn(async () => undefined),
    revealInFileManager: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    createDir: vi.fn(async () => undefined),
  },
}));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));
vi.mock('../src/lib/versions', () => ({
  snapshotBeforeDelete: vi.fn(async () => undefined),
  recordRenameLineage: vi.fn(async () => undefined),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:\\连载\\末世吞噬';
const CHAPTER = `${PROJECT}\\正文\\第006章.md`;
const fsMock = vi.mocked(TauriFileSystem);
const toast = vi.mocked(emitToast);

function dir(path: string): FileEntry {
  return { name: path.split('\\').pop()!, path, isDir: true, size: 0, modified: 0 };
}

function mount(openPaths: string[] = []) {
  const choose = vi.fn(
    async (_options: { choices: { id: string; label: string }[] }) => null as string | null,
  );
  const prompt = vi.fn(
    async (_options: { message: string; defaultValue?: string }) => null as string | null,
  );
  const alert = vi.fn(async (_options: { title: string; message: string }) => {});
  const dialogs = { alert, choose, prompt, confirm: vi.fn() } as unknown as AppDialogApi;
  const confirmDiscardFiles = vi.fn(async () => true);
  const retargetOpenPaths = vi.fn();
  const openFile = vi.fn(async () => {});
  let actions: FileTreeActions | null = null;
  function Probe() {
    actions = useFileTreeActions({
      activeProject: PROJECT,
      dialogs,
      openFile,
      dropOpenPathsUnder: () => {},
      confirmDiscardFiles,
      openPaths,
      retargetOpenPaths,
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(Probe)));
  return {
    choose,
    prompt,
    alert,
    confirmDiscardFiles,
    retargetOpenPaths,
    openFile,
    actions: () => actions!,
    cleanup: () => act(() => root.unmount()),
  };
}

function undoAction(): ToastAction {
  const call = toast.mock.calls.find(([, options]) => options?.action);
  assert.ok(call, '移完要给带「撤销」的通知');
  return call[1]!.action!;
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.projectPathExists.mockImplementation(async () => false);
  // 宿主的递归列目录会把作品根自己也列进来。
  fsMock.listProjectDir.mockImplementation(async () => [
    dir(PROJECT),
    dir(`${PROJECT}\\正文`),
    dir(`${PROJECT}\\正文\\旧稿`),
    dir(`${PROJECT}\\.草稿`),
    dir(`${PROJECT}\\.storyforge`),
    dir(`${PROJECT}\\.storyforge\\canon`),
  ]);
});

afterEach(() => {
  document.body.innerHTML = '';
});

test('副本默认名接着排；「第003章」先叫「副本」，重名再加编号', () => {
  assert.equal(copyName('第003章.md', []), '第003章 副本.md');
  assert.equal(copyName('第003章.md', ['第003章 副本.MD']), '第003章 副本 2.md');
  assert.equal(copyName('笔记', ['笔记 副本', '笔记 副本 2']), '笔记 副本 3');
});

test('哪些路径会被手稿当成一章：与引擎排阅读序同一条规则', () => {
  assert.equal(countsAsChapter('正文\\第006章 副本.md'), true);
  assert.equal(countsAsChapter('第一章.md'), true);
  assert.equal(countsAsChapter('.草稿/第006章 副本.md'), false);
  assert.equal(countsAsChapter('设定/人物.md'), false);
  assert.equal(countsAsChapter('技能\\立项流程.md'), false);
  assert.equal(countsAsChapter('灵感.md'), false);
  assert.equal(countsAsChapter('正文/图.png'), false);
});

test('移动到…：候选里没有自己所在的文件夹和 .storyforge；挑中后走改名同一条路，可撤销', async () => {
  const harness = mount([CHAPTER]);
  try {
    harness.choose.mockResolvedValueOnce(`${PROJECT}\\.草稿`);
    await act(async () => harness.actions().onMove!(CHAPTER, false));
    const options = harness.choose.mock.calls[0]![0] as {
      choices: { label: string }[];
      noDefault?: boolean;
    };
    assert.deepEqual(
      options.choices.map((choice) => choice.label),
      ['作品根目录', '.草稿', '正文\\旧稿'],
    );
    // 没有默认项：回车不会替作者把文件挪走。
    assert.equal(options.noDefault, true);
    const moved = `${PROJECT}\\.草稿\\第006章.md`;
    assert.deepEqual(harness.confirmDiscardFiles.mock.calls[0], [[CHAPTER], '移动']);
    assert.deepEqual(fsMock.renamePath.mock.calls[0], [PROJECT, CHAPTER, moved]);
    assert.deepEqual(vi.mocked(recordRenameLineage).mock.calls[0], [
      PROJECT,
      [{ from: CHAPTER, to: moved }],
    ]);
    assert.deepEqual(harness.retargetOpenPaths.mock.calls[0], [CHAPTER, moved]);
    assert.match(String(toast.mock.calls[0]![0]), /已把「第006章.md」移到「.草稿」/);

    await act(async () => undoAction().run());
    assert.deepEqual(fsMock.renamePath.mock.calls[1], [PROJECT, moved, CHAPTER]);
  } finally {
    harness.cleanup();
  }
});

test('移动目标已有同名：不挪，说清楚；文件夹不能移进它自己里面', async () => {
  const harness = mount();
  try {
    fsMock.projectPathExists.mockImplementation(
      async (_root, path) => path === `${PROJECT}\\.草稿\\第006章.md`,
    );
    harness.choose.mockResolvedValueOnce(`${PROJECT}\\.草稿`);
    await act(async () => harness.actions().onMove!(CHAPTER, false));
    assert.equal(fsMock.renamePath.mock.calls.length, 0);
    assert.match(harness.alert.mock.calls[0]![0].message, /已经有同名的「第006章.md」/);

    await act(async () => harness.actions().onMove!(`${PROJECT}\\正文`, true));
    const labels = harness.choose.mock.calls[1]![0].choices.map((choice) => choice.label);
    assert.equal(labels.includes('正文'), false);
    assert.equal(labels.includes('正文\\旧稿'), false);
  } finally {
    harness.cleanup();
  }
});

test('复制一份：正文里的副本会排进手稿，先说清楚；写出原文并打开', async () => {
  const harness = mount();
  try {
    fsMock.readProjectFile.mockResolvedValue('# 第006章\n\n他推开门。\n');
    harness.prompt.mockImplementationOnce(async (options) => options.defaultValue ?? null);
    await act(async () => harness.actions().onDuplicate!(CHAPTER));
    const options = harness.prompt.mock.calls[0]![0];
    assert.equal(options.defaultValue, '第006章 副本.md');
    assert.match(options.message, /副本也会排进手稿/);
    const copy = `${PROJECT}\\正文\\第006章 副本.md`;
    assert.deepEqual(fsMock.writeFileIfUnchanged.mock.calls[0], [
      PROJECT,
      copy,
      '# 第006章\n\n他推开门。\n',
      { kind: 'missing' },
    ]);
    assert.equal(fsMock.writeFile.mock.calls.length, 0);
    assert.deepEqual(harness.openFile.mock.calls[0], [copy, '打开副本']);

    await act(async () => harness.actions().onDuplicate!(`${PROJECT}\\.草稿\\备忘.md`));
    assert.doesNotMatch(harness.prompt.mock.calls[1]![0].message, /排进手稿/);
  } finally {
    harness.cleanup();
  }
});

test('在资源管理器中显示：交给宿主；宿主拒绝就弹出原因', async () => {
  const harness = mount();
  try {
    await act(async () => harness.actions().onReveal!(CHAPTER));
    assert.deepEqual(fsMock.revealInFileManager.mock.calls[0], [PROJECT, CHAPTER]);
    fsMock.revealInFileManager.mockRejectedValueOnce(new Error('路径不在当前作品内'));
    await act(async () => harness.actions().onReveal!(CHAPTER));
    assert.match(harness.alert.mock.calls[0]![0].message, /路径不在当前作品内/);
  } finally {
    harness.cleanup();
  }
});

test.each(['外部作者刚刚写入的内容', ''])(
  '复制时源文件读取期间出现同名目标，保留其内容：%j',
  async (externalContent) => {
    const harness = mount();
    const copy = `${PROJECT}\\正文\\第006章 副本.md`;
    const original = '# 第006章\n\n原稿内容。\n';
    const disk = new Map([[CHAPTER, original]]);
    const actual =
      await vi.importActual<typeof import('../src/lib/tauri-fs')>('../src/lib/tauri-fs');
    const previousFixture = window.__STORYFORGE_MOCK_FS__;
    let enterRead!: () => void;
    const entered = new Promise<void>((resolve) => {
      enterRead = resolve;
    });
    let finishRead!: (content: string) => void;
    const readGate = new Promise<string>((resolve) => {
      finishRead = resolve;
    });
    const write = vi.fn((path: string, content: string) => {
      disk.set(path, content);
    });
    try {
      window.__STORYFORGE_MOCK_FS__ = {
        pathExists: (path) => disk.has(path),
        readFile: (path) => disk.get(path) ?? '',
        writeFile: write,
      };
      fsMock.projectPathExists.mockImplementation(async (_root, path) => disk.has(path));
      fsMock.writeFile.mockImplementation(async (_root, path, content) => write(path, content));
      fsMock.writeFileIfUnchanged.mockImplementation(actual.TauriFileSystem.writeFileIfUnchanged);
      fsMock.readProjectFile.mockImplementation(async () => {
        enterRead();
        return readGate;
      });
      harness.prompt.mockImplementationOnce(async (options) => options.defaultValue ?? null);
      await act(async () => {
        const operation = harness.actions().onDuplicate!(CHAPTER);
        await entered;
        disk.set(copy, externalContent);
        finishRead(original);
        await operation;
      });
      assert.equal(disk.get(copy), externalContent);
      assert.equal(disk.get(CHAPTER), original);
      assert.equal(write.mock.calls.length, 0);
      assert.equal(harness.openFile.mock.calls.length, 0);
      assert.equal(
        toast.mock.calls.some(([message]) => String(message).includes('已复制为')),
        false,
      );
      assert.match(harness.alert.mock.calls[0]![0].message, /磁盘内容已变化/);
    } finally {
      window.__STORYFORGE_MOCK_FS__ = previousFixture;
      fsMock.readProjectFile.mockResolvedValue('');
      fsMock.writeFile.mockResolvedValue(undefined);
      fsMock.writeFileIfUnchanged.mockResolvedValue(undefined);
      harness.cleanup();
    }
  },
);
