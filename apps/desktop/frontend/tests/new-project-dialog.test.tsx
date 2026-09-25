import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { useProjectCommands, type ProjectCommands } from '../src/components/app/useProjectCommands';
import { NewProjectDialog } from '../src/components/app/NewProjectDialog';
import { useAppDialog, AppDialogHost } from '../src/components/app/AppDialog';
import { createBlankStoryProject, createNewBookProject } from '../src/lib/project-context';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../src/lib/project-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/project-context')>()),
  createBlankStoryProject: vi.fn(),
  createNewBookProject: vi.fn(),
}));
vi.mock('../src/lib/smoke', () => ({
  registerSmokeFileLoader: () => () => {},
  registerSmokeProjectLoader: () => () => {},
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let commands: ProjectCommands;
let activeProject = 'D:/Existing';
let realConfirm = false;
const selectProject = vi.fn();
const resetEditorFiles = vi.fn();
const confirmDiscardFiles = vi.fn(async (_paths: string[], _label: string) => true);
const openFile = vi.fn(async () => {});
const onShowEditor = vi.fn();

function Harness() {
  const dialogs = useAppDialog();
  commands = useProjectCommands({
    activeProject,
    currentFile: 'D:/Existing/正文/原稿.md',
    dirtyFiles: new Set(['D:/Existing/正文/原稿.md']),
    openFiles: ['D:/Existing/正文/原稿.md'],
    dialogs,
    selectProject,
    selectProjectSafely: async () => true,
    openFile,
    confirmDiscardFiles: realConfirm
      ? async (_paths, label) =>
          dialogs.confirm({ title: '保留未保存稿件', message: label, confirmLabel: '放弃并新建' })
      : confirmDiscardFiles,
    resetEditorFiles,
    onShowEditor,
  });
  return (
    <>
      <button onClick={commands.newProject.open}>新建作品入口</button>
      <NewProjectDialog controller={commands.newProject} />
      <AppDialogHost
        dialog={dialogs.dialog}
        onClose={dialogs.closeDialog}
        onPromptValueChange={dialogs.updatePromptValue}
      />
    </>
  );
}
function button(text: string) {
  const result = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === text,
  );
  expect(result, text).toBeTruthy();
  return result!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
function titleInput() {
  return container.querySelector<HTMLInputElement>('#new-project-title')!;
}
async function fillTitle(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      titleInput(),
      value,
    );
    titleInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function prepare() {
  await click('新建作品入口');
  await fillTitle('雾港回声');
  await click('选择文件夹');
}

beforeEach(async () => {
  vi.clearAllMocks();
  activeProject = 'D:/Existing';
  realConfirm = false;
  vi.mocked(open).mockResolvedValue('D:/Books');
  vi.mocked(createBlankStoryProject).mockResolvedValue('D:/Books/雾港回声');
  confirmDiscardFiles.mockResolvedValue(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test('dialog names the real target, confirms dirty files, then creates/selects once without a model prompt or fake chapter', async () => {
  await act(async () => commands.setWelcomeDraft('已有 Agent 草稿'));
  await prepare();
  expect(container.querySelector('[data-testid="new-project-target"]')?.textContent).toBe(
    'D:/Books/雾港回声',
  );
  expect(open).toHaveBeenCalledExactlyOnceWith({
    directory: true,
    multiple: false,
    title: '选择作品保存位置',
  });
  await click('创建作品');
  expect(confirmDiscardFiles).toHaveBeenCalledExactlyOnceWith(
    ['D:/Existing/正文/原稿.md'],
    '新建作品',
  );
  expect(createBlankStoryProject).toHaveBeenCalledExactlyOnceWith('D:/Books', '雾港回声');
  expect(resetEditorFiles).toHaveBeenCalledTimes(1);
  expect(selectProject).toHaveBeenCalledExactlyOnceWith('D:/Books/雾港回声');
  expect(commands.projectRefreshVersion).toBe(1);
  expect(commands.pendingWelcomePrompt).toBeNull();
  expect(commands.welcomeDraft).toBe('已有 Agent 草稿');
  expect(createNewBookProject).not.toHaveBeenCalled();
  expect(openFile).not.toHaveBeenCalled();
  expect(container.querySelector('[data-testid="new-project-dialog"]')).toBeNull();
});

test('canceling directory selection preserves fields and the existing workspace without confirmation', async () => {
  vi.mocked(open).mockResolvedValue(null);
  await prepare();
  expect(titleInput().value).toBe('雾港回声');
  expect(commands.newProject.parentPath).toBe('');
  await click('取消');
  expect(confirmDiscardFiles).not.toHaveBeenCalled();
  expect(createBlankStoryProject).not.toHaveBeenCalled();
  expect(resetEditorFiles).not.toHaveBeenCalled();
  expect(selectProject).not.toHaveBeenCalled();
});

test('invalid title is reported before dirty confirmation or creating a directory', async () => {
  await prepare();
  await fillTitle('CON.txt');
  await click('创建作品');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('保留目录名');
  expect(confirmDiscardFiles).not.toHaveBeenCalled();
  expect(createBlankStoryProject).not.toHaveBeenCalled();
});

test('rejecting discard keeps dialog fields, original workspace and drafts', async () => {
  confirmDiscardFiles.mockResolvedValue(false);
  await prepare();
  await click('创建作品');
  expect(titleInput().value).toBe('雾港回声');
  expect(commands.newProject.parentPath).toBe('D:/Books');
  expect(createBlankStoryProject).not.toHaveBeenCalled();
  expect(resetEditorFiles).not.toHaveBeenCalled();
  expect(selectProject).not.toHaveBeenCalled();
  expect(commands.newProject.busy).toBe(false);
});

test('filesystem failure keeps fields/error and allows a genuine retry without resetting the workspace early', async () => {
  vi.mocked(createBlankStoryProject).mockRejectedValueOnce(new Error('目标目录已存在'));
  await prepare();
  await click('创建作品');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('目标目录已存在');
  expect(titleInput().value).toBe('雾港回声');
  expect(resetEditorFiles).not.toHaveBeenCalled();
  await click('创建作品');
  expect(createBlankStoryProject).toHaveBeenCalledTimes(2);
  expect(selectProject).toHaveBeenCalledTimes(1);
});

test('same-frame duplicate submission has one synchronous claim across confirmation and filesystem write', async () => {
  const pending = deferred<string>();
  vi.mocked(createBlankStoryProject).mockReturnValue(pending.promise);
  await prepare();
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = commands.newProject.create();
    second = commands.newProject.create();
  });
  expect(confirmDiscardFiles).toHaveBeenCalledTimes(1);
  expect(createBlankStoryProject).toHaveBeenCalledTimes(1);
  expect(commands.newProject.busy).toBe(true);
  expect(resetEditorFiles).not.toHaveBeenCalled();
  await act(async () => commands.newProject.close());
  expect(commands.newProject.isOpen).toBe(true);
  await act(async () => {
    pending.resolve('D:/Books/雾港回声');
    await Promise.all([first, second]);
  });
  expect(selectProject).toHaveBeenCalledTimes(1);
});

test('native directory errors remain recoverable and a canceled second picker preserves the prior location', async () => {
  await prepare();
  vi.mocked(open).mockRejectedValueOnce(new Error('选择器失败'));
  await click('选择文件夹');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('选择器失败');
  expect(commands.newProject.parentPath).toBe('D:/Books');
  vi.mocked(open).mockResolvedValueOnce(null);
  await click('选择文件夹');
  expect(commands.newProject.parentPath).toBe('D:/Books');
  expect(selectProject).not.toHaveBeenCalled();
});

test('initial focus, Tab wrap, composing Escape, and ordinary Escape preserve native keyboard behavior', async () => {
  const opener = button('新建作品入口');
  opener.focus();
  await click('新建作品入口');
  expect(document.activeElement).toBe(titleInput());
  await act(async () =>
    titleInput().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(button('取消'));
  await act(async () =>
    button('取消').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(titleInput());
  await act(async () =>
    titleInput().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
    ),
  );
  expect(commands.newProject.isOpen).toBe(true);
  await act(async () =>
    titleInput().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  );
  expect(commands.newProject.isOpen).toBe(false);
  expect(document.activeElement).toBe(opener);
});

test('a pending confirmation cannot create after an external project switch', async () => {
  const pending = deferred<boolean>();
  confirmDiscardFiles.mockReturnValueOnce(pending.promise);
  await prepare();
  let creating!: Promise<void>;
  await act(async () => {
    creating = commands.newProject.create();
  });
  activeProject = 'D:/Different';
  await act(async () => root.render(<Harness />));
  await act(async () => {
    pending.resolve(true);
    await creating;
  });
  expect(createBlankStoryProject).not.toHaveBeenCalled();
  expect(selectProject).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('作品已切换');
});

test('unmount during authorized disk creation does not select a project or reset the old editor on late completion', async () => {
  const pending = deferred<string>();
  vi.mocked(createBlankStoryProject).mockReturnValueOnce(pending.promise);
  await prepare();
  let creating!: Promise<void>;
  await act(async () => {
    creating = commands.newProject.create();
  });
  await act(async () => root.render(<div>卸载</div>));
  await act(async () => {
    pending.resolve('D:/Books/雾港回声');
    await creating;
  });
  expect(selectProject).not.toHaveBeenCalled();
  expect(resetEditorFiles).not.toHaveBeenCalled();
});

test('real dirty-file dialog stacks above creation and returns focus when discard is canceled', async () => {
  realConfirm = true;
  await act(async () => root.render(<Harness />));
  await prepare();
  await click('创建作品');
  const confirmDialog = container.querySelector('[data-testid="app-dialog"]')!;
  expect(confirmDialog.textContent).toContain('保留未保存稿件');
  expect(confirmDialog.contains(document.activeElement)).toBe(true);
  await act(async () => confirmDialog.querySelector<HTMLButtonElement>('button')!.click());
  expect(container.querySelector('[data-testid="app-dialog"]')).toBeNull();
  expect(document.activeElement).toBe(titleInput());
  expect(createBlankStoryProject).not.toHaveBeenCalled();
  expect(commands.newProject.busy).toBe(false);
  await click('创建作品');
  await click('放弃并新建');
  expect(createBlankStoryProject).toHaveBeenCalledExactlyOnceWith('D:/Books', '雾港回声');
});

test('success does not send focus back into the library opener that is about to be hidden', async () => {
  const opener = button('新建作品入口');
  opener.focus();
  await prepare();
  await click('创建作品');
  expect(document.activeElement).not.toBe(opener);
});

test('same-frame double directory picker opens only one native picker', async () => {
  const pending = deferred<string | null>();
  vi.mocked(open).mockReturnValueOnce(pending.promise);
  await click('新建作品入口');
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = commands.newProject.chooseDirectory();
    second = commands.newProject.chooseDirectory();
  });
  expect(open).toHaveBeenCalledTimes(1);
  expect(commands.newProject.choosingDirectory).toBe(true);
  await act(async () => {
    pending.resolve(null);
    await Promise.all([first, second]);
  });
  expect(commands.newProject.choosingDirectory).toBe(false);
});

test('blank success clears an unconsumed legacy welcome prompt rather than carrying it into the new book', async () => {
  vi.mocked(createNewBookProject).mockResolvedValueOnce({
    projectPath: 'D:/Legacy',
    seedFilePath: 'D:/Legacy/灵感.md',
  });
  await act(async () => commands.setWelcomeDraft('历史灵感'));
  await act(async () => commands.handleWelcomeSend());
  expect(commands.pendingWelcomePrompt).toBe('历史灵感');
  await prepare();
  await click('创建作品');
  expect(commands.pendingWelcomePrompt).toBeNull();
  expect(commands.welcomeDraft).toBe('历史灵感');
  expect(createNewBookProject).toHaveBeenCalledTimes(1);
});

test('external project A→B→A while disk creation is pending cannot reset or select on late completion', async () => {
  const pending = deferred<string>();
  vi.mocked(createBlankStoryProject).mockReturnValueOnce(pending.promise);
  await prepare();
  let creating!: Promise<void>;
  await act(async () => {
    creating = commands.newProject.create();
  });
  activeProject = 'D:/Different';
  await act(async () => root.render(<Harness />));
  activeProject = 'D:/Existing';
  await act(async () => root.render(<Harness />));
  await act(async () => {
    pending.resolve('D:/Books/雾港回声');
    await creating;
  });
  expect(selectProject).not.toHaveBeenCalled();
  expect(resetEditorFiles).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    '作品已创建于 D:/Books/雾港回声',
  );
});
