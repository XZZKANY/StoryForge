/**
 * 新建章节（作者 10-17 巡检）：旁边就是第001–005章，默认名却是 untitled.md、光标停在末尾、
 * 正文是「# 新建文件」；顶部按钮还把文件建在作品根目录，手稿把它排成第 1 章。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import { AppDialogHost } from '../src/components/app/AppDialog';
import type { AppDialogApi } from '../src/components/app/AppDialog';
import { useFileTreeActions, type FileTreeActions } from '../src/components/app/useFileTreeActions';
import { SidePanel } from '../src/components/shell/SidePanel';
import { useChapterHandoff } from '../src/components/app/useChapterHandoff';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { suggestNewFileName } from '../src/lib/fs-path-ops';
import { TauriFileSystem } from '../src/lib/tauri-fs';

vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    projectPathExists: vi.fn(async () => false),
    writeFile: vi.fn(async () => undefined),
    listProjectDir: vi.fn(async () => []),
  },
  FS_MUTATION_EVENT: 'storyforge:fs-mutation',
  invalidateFileSystemCache: () => {},
}));

vi.mock('../src/lib/api/ide-commands', () => ({
  executeIdeCommand: vi.fn(async () => ({ payload: { book_context: null } })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'D:\\连载\\末世吞噬';
const DIR = `${PROJECT}\\正文`;
const mockedListDir = vi.mocked(TauriFileSystem.listProjectDir);
const mockedWrite = vi.mocked(TauriFileSystem.writeFile);
const noop = () => {};

afterEach(() => {
  document.body.innerHTML = '';
  mockedWrite.mockClear();
});

test('默认名接着同目录的章号往下编，位数照最宽的补零；没有章节时叫「未命名.md」', () => {
  assert.equal(suggestNewFileName(['第001章.md', '第005章.md', '第003章 夜探.md']), '第006章.md');
  assert.equal(suggestNewFileName(['第99章.md', '第100章.md']), '第101章.md');
  assert.equal(suggestNewFileName(['第9章.md']), '第010章.md');
  assert.equal(suggestNewFileName(['人物.md', '大纲.md']), '未命名.md');
  assert.equal(suggestNewFileName([]), '未命名.md');
});

test('在正文里新建：默认给下一章的名字，建好的正文是这一章的标题', async () => {
  mockedListDir.mockResolvedValueOnce(
    ['第001章.md', '第002章.md', '第005章.md'].map((name) => ({
      name,
      path: `${DIR}\\${name}`,
      isDir: false,
    })) as never,
  );
  const prompt = vi.fn(async (options: { defaultValue?: string }) => options.defaultValue ?? null);
  const dialogs = {
    alert: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    choose: vi.fn(async () => null),
    prompt,
  } as unknown as AppDialogApi;
  const openFile = vi.fn(async () => {});
  let actions: FileTreeActions | null = null;
  function Probe() {
    actions = useFileTreeActions({
      activeProject: PROJECT,
      dialogs,
      openFile,
      dropOpenPathsUnder: noop,
      confirmDiscardFiles: async () => true,
      openPaths: [],
      retargetOpenPaths: noop,
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(Probe)));
  await act(async () => actions!.onNewFile(DIR));

  assert.equal(prompt.mock.calls[0]?.[0]?.defaultValue, '第006章.md');
  assert.deepEqual(mockedWrite.mock.calls[0]?.slice(1, 3), [`${DIR}\\第006章.md`, '# 第006章\n\n']);
  act(() => root.unmount());
});

test('输入框一弹出只选中扩展名前面的部分：直接打字就换掉名字、留着 .md', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AppDialogHost
        dialog={{
          kind: 'prompt',
          title: '重命名文件',
          message: '输入新名称：',
          confirmLabel: '重命名',
          cancelLabel: '取消',
          defaultValue: '第006章.md',
          value: '第006章.md',
          resolve: () => {},
        }}
        onClose={noop}
        onPromptValueChange={noop}
      />,
    ),
  );
  const input = container.querySelector<HTMLInputElement>('[data-testid="app-dialog-input"]')!;
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, '第006章'.length]);
  act(() => root.unmount());
});

test('顶部「新建文件」建在正在写的那章旁边，不再落到作品根目录', () => {
  const onNewFile = vi.fn(async () => {});
  const fileActions: FileTreeActions = {
    onNewFile,
    onNewFolder: vi.fn(async () => {}),
    onRename: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (currentFile: string | null) =>
    act(() =>
      root.render(
        <SidePanel
          view="explorer"
          projects={[PROJECT]}
          activeProject={PROJECT}
          currentFile={currentFile}
          previewFile={null}
          projectRefreshVersion={0}
          onSelectProject={noop}
          onRemoveProject={noop}
          onOpenProject={noop}
          onFileSelect={noop}
          onFilePreview={noop}
          fileActions={fileActions}
          width={300}
          onWidthChange={noop}
        />,
      ),
    );
  render(`${DIR}\\第005章.md`);
  // 书名过长会被截断，悬停要看得到全名。
  assert.equal(
    container.querySelector<HTMLButtonElement>('[data-testid="toggle-project-library"]')?.title,
    '末世吞噬（切换作品）',
  );
  const button = container.querySelector<HTMLButtonElement>('[data-testid="side-new-file"]')!;
  assert.equal(button.title, '在「正文」里新建文件');
  act(() => button.click());
  assert.deepEqual(onNewFile.mock.calls[0], [DIR]);

  render(null);
  const rootButton = container.querySelector<HTMLButtonElement>('[data-testid="side-new-file"]')!;
  assert.equal(rootButton.title, '在作品根目录新建文件');
  act(() => rootButton.click());
  assert.deepEqual(onNewFile.mock.calls[1], [PROJECT]);
  act(() => root.unmount());
});

test('最后一章还空着时按这个空章去要上一章结尾：后端给回的正是真正写到的那章', async () => {
  const mockedCommand = vi.mocked(executeIdeCommand);
  mockedCommand.mockClear();
  const chapters = [
    { ordinal: 5, relativePath: '正文/第005章.md', estimatedChars: 3000 },
    { ordinal: 6, relativePath: '正文/第006章.md', estimatedChars: 4 },
  ];
  function Probe() {
    useChapterHandoff({ projectPath: PROJECT, chapters, promises: null });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Probe)));
  assert.deepEqual(mockedCommand.mock.calls[0]?.[1], {
    project_root: PROJECT,
    current_file: '正文/第006章.md',
  });
  act(() => root.unmount());
});
