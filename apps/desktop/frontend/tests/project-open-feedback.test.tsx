import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';

import { AppDialogHost, useAppDialog } from '../src/components/app/AppDialog';
import { useProjectCommands } from '../src/components/app/useProjectCommands';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../src/lib/smoke', () => ({
  registerSmokeFileLoader: () => () => {},
  registerSmokeProjectLoader: () => () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const selectProjectSafely = vi.fn(async (_path: string) => true);
const selectProject = vi.fn();
const resetEditorFiles = vi.fn();

function Harness() {
  const dialogs = useAppDialog();
  const commands = useProjectCommands({
    activeProject: null,
    currentFile: null,
    dirtyFiles: new Set<string>(),
    openFiles: [],
    dialogs,
    selectProject,
    selectProjectSafely,
    openFile: async () => {},
    confirmDiscardFiles: async () => true,
    resetEditorFiles,
    onShowEditor: () => {},
  });
  return (
    <>
      <button onClick={() => void commands.handleOpenProject()}>打开项目</button>
      <AppDialogHost
        dialog={dialogs.dialog}
        onClose={dialogs.closeDialog}
        onPromptValueChange={dialogs.updatePromptValue}
      />
    </>
  );
}

async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === text,
  );
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(open).mockResolvedValue(null);
  selectProjectSafely.mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

test('目录选择异常显示可读原因与下一步，关闭提示后可再次打开', async () => {
  vi.mocked(open).mockRejectedValueOnce(new Error('目录选择器暂时不可用'));
  await click('打开项目');
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain('打开项目失败');
  expect(dialog?.textContent).toContain('目录选择器暂时不可用');
  expect(dialog?.textContent).toContain('重新选择');
  expect(selectProjectSafely).not.toHaveBeenCalled();
  expect(resetEditorFiles).not.toHaveBeenCalled();
  await click('知道了');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  vi.mocked(open).mockResolvedValueOnce('D:/acceptance/project');
  await click('打开项目');
  expect(selectProjectSafely).toHaveBeenCalledExactlyOnceWith('D:/acceptance/project');
});

test('选中目录后项目切换失败也显示错误，不直接绕过守卫切换或清理编辑器', async () => {
  vi.mocked(open).mockResolvedValue('D:/acceptance/project');
  selectProjectSafely.mockRejectedValueOnce('目录已移动或无权访问');
  await click('打开项目');
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('目录已移动或无权访问');
  expect(selectProject).not.toHaveBeenCalled();
  expect(resetEditorFiles).not.toHaveBeenCalled();
  await click('知道了');
});

test('取消目录选择或拒绝项目切换都安静结束，不展示失败也不重试', async () => {
  await click('打开项目');
  expect(selectProjectSafely).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  vi.mocked(open).mockResolvedValueOnce('D:/acceptance/project');
  selectProjectSafely.mockResolvedValueOnce(false);
  await click('打开项目');
  expect(selectProjectSafely).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(selectProject).not.toHaveBeenCalled();
  expect(resetEditorFiles).not.toHaveBeenCalled();
});
