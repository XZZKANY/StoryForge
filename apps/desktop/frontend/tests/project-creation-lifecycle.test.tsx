import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  create: vi.fn(),
  sample: vi.fn(),
  open: vi.fn(),
  select: vi.fn(),
  reset: vi.fn(),
  toast: vi.fn(),
  file: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mock.open }));
vi.mock('../src/lib/project-context', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createNewBookProject: mock.create,
  createSampleStoryProject: mock.sample,
}));
vi.mock('../src/lib/toast', () => ({ emitToast: mock.toast }));
vi.mock('../src/lib/smoke', () => ({
  registerSmokeFileLoader: () => () => {},
  registerSmokeProjectLoader: () => () => {},
}));
import { WelcomeWorkspace } from '../src/components/app/WelcomeWorkspace';
import { useProjectCommands } from '../src/components/app/useProjectCommands';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let commands: ReturnType<typeof useProjectCommands>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function Harness({ project = null }: { project?: string | null }) {
  commands = useProjectCommands({
    activeProject: project,
    currentFile: null,
    dirtyFiles: new Set(),
    openFiles: [],
    dialogs: {
      confirm: async () => true,
      choose: async () => null,
      prompt: async () => null,
      alert: async () => {},
    },
    selectProject: mock.select,
    selectProjectSafely: async (path) => {
      mock.select(path);
      return true;
    },
    openFile: mock.file,
    confirmDiscardFiles: async () => true,
    resetEditorFiles: mock.reset,
    onShowEditor: () => {},
  });
  return (
    <WelcomeWorkspace
      onOpenProject={() => {}}
      onNewFile={() => {}}
      onOpenPalette={() => {}}
      onCreateSampleProject={() => void commands.handleCreateSampleProject()}
      onOpenSettings={() => {}}
      onShowShortcuts={() => {}}
      onShowAbout={() => {}}
      onClose={() => {}}
      recentProjects={[]}
      onSelectRecent={() => {}}
      showOnStartup
      onToggleShowOnStartup={() => {}}
      projectCreationBusy={commands.projectCreationBusy}
      composerValue={commands.welcomeDraft}
      onComposerChange={commands.setWelcomeDraft}
      onComposerSend={commands.handleWelcomeSend}
    />
  );
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
beforeEach(async () => {
  vi.clearAllMocks();
  mock.select.mockReset();
  mock.open.mockResolvedValue('D:/samples');
  mock.file.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function send() {
  act(() => commands.setWelcomeDraft('新的故事'));
  await act(async () => commands.handleWelcomeSend());
}

test('开书结果晚于用户切换项目，不清页签、不自动打开或发送旧提示词', async () => {
  const pending = deferred<{ projectPath: string; seedFilePath: string }>();
  mock.create.mockReturnValue(pending.promise);
  await send();
  await act(async () => root.render(<Harness project="D:/other" />));
  await act(async () => {
    pending.resolve({ projectPath: 'D:/created', seedFilePath: 'D:/created/start.md' });
    await pending.promise;
  });
  assert.equal(mock.select.mock.calls.length, 0);
  assert.equal(mock.reset.mock.calls.length, 0);
  assert.equal(mock.file.mock.calls.length, 0);
  assert.equal(commands.pendingWelcomePrompt, null);
  assert.equal(commands.welcomeDraft, '新的故事');
  assert.equal(mock.toast.mock.calls.length, 1);
});
test('重复发送及交叉创建样例只允许一次创建', async () => {
  const pending = deferred<{ projectPath: string; seedFilePath: string }>();
  mock.create.mockReturnValue(pending.promise);
  await send();
  await act(async () => {
    commands.handleWelcomeSend();
    await commands.handleCreateSampleProject();
  });
  assert.equal(mock.create.mock.calls.length, 1);
  assert.equal(mock.open.mock.calls.length, 0);
  await act(async () => {
    pending.resolve({ projectPath: 'D:/created', seedFilePath: 'D:/created/start.md' });
    await pending.promise;
  });
});
test('开书失败晚返回不再弹目录选择器打断新项目', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const pending = deferred<{ projectPath: string; seedFilePath: string }>();
  mock.create.mockReturnValue(pending.promise);
  await send();
  await act(async () => root.render(<Harness project="D:/other" />));
  await act(async () => {
    pending.reject(new Error('creation failed'));
    await pending.promise.catch(() => {});
  });
  assert.equal(mock.open.mock.calls.length, 0);
  assert.equal(mock.select.mock.calls.length, 0);
});
test('样例创建晚返回只通知落点，不强行切换新工作区', async () => {
  const pending = deferred<string>();
  mock.sample.mockReturnValue(pending.promise);
  let action!: Promise<void>;
  await act(async () => {
    action = commands.handleCreateSampleProject();
  });
  await act(async () => root.render(<Harness project="D:/other" />));
  await act(async () => {
    pending.resolve('D:/samples/example');
    await action;
  });
  assert.equal(mock.select.mock.calls.length, 0);
  assert.equal(mock.reset.mock.calls.length, 0);
  assert.equal(mock.toast.mock.calls.length, 1);
});

test('创建中有可见状态，输入只读且发送禁用，取消后可重试', async () => {
  const pending = deferred<string | null>();
  mock.open.mockReturnValueOnce(pending.promise);
  let action!: Promise<void>;
  await act(async () => {
    action = commands.handleCreateSampleProject();
  });
  assert.equal(commands.projectCreationBusy, true);
  assert.equal(
    container.querySelector<HTMLInputElement>('[aria-label="一句话开新书"]')?.readOnly,
    true,
  );
  assert.equal(
    container.querySelector<HTMLButtonElement>('[aria-label="发送即开书"]')?.disabled,
    true,
  );
  assert.equal(
    container.querySelector('[role="status"]')?.textContent?.includes('正在创建项目'),
    true,
  );
  await act(async () => {
    pending.resolve(null);
    await action;
  });
  assert.equal(commands.projectCreationBusy, false);
  assert.equal(
    container.querySelector<HTMLInputElement>('[aria-label="一句话开新书"]')?.readOnly,
    false,
  );
});

test('正常开书只向创建目标交付首句，离开后再返回不复活旧首句', async () => {
  mock.select.mockImplementation((path) => root.render(<Harness project={path} />));
  mock.create.mockResolvedValue({ projectPath: 'D:/created', seedFilePath: 'D:/created/start.md' });
  await send();
  assert.equal(commands.projectCreationBusy, false);
  assert.equal(commands.pendingWelcomePrompt, '新的故事');
  assert.deepEqual(mock.file.mock.calls, [['D:/created/start.md']]);
  await act(async () => root.render(<Harness project="D:/other" />));
  assert.equal(commands.pendingWelcomePrompt, null);
  await act(async () => root.render(<Harness project="D:/created" />));
  assert.equal(commands.pendingWelcomePrompt, null);
});

test('晚完成通知的打开动作仍走安全导航，不补发旧首句', async () => {
  const pending = deferred<string>();
  mock.sample.mockReturnValueOnce(pending.promise);
  let action!: Promise<void>;
  await act(async () => {
    action = commands.handleCreateSampleProject();
  });
  await act(async () => root.render(<Harness project="D:/other" />));
  await act(async () => {
    pending.resolve('D:/samples/example');
    await action;
  });
  assert.equal(mock.select.mock.calls.length, 0);
  const notification = mock.toast.mock.calls[0][1];
  assert.equal(notification.action.label, '打开项目');
  await act(async () => notification.action.run());
  assert.deepEqual(mock.select.mock.calls, [['D:/samples/example']]);
  assert.equal(commands.pendingWelcomePrompt, null);
});
