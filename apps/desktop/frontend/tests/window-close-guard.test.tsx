import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, test, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  listener: null as null | ((event: { preventDefault: () => void }) => Promise<void>),
  unlisten: vi.fn(),
  choose: vi.fn(),
  confirm: vi.fn(),
  alert: vi.fn(),
  flush: vi.fn(),
  additionalClose: vi.fn(),
  projectChange: vi.fn(),
  selectProject: vi.fn(),
  removeProject: vi.fn(),
}));
vi.mock('../src/lib/tauri-env', () => ({ isTauriRuntime: () => true }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: typeof mock.listener) => {
      mock.listener = handler;
      return mock.unlisten;
    },
  }),
}));
vi.mock('../src/lib/assistant-events', () => ({ flushActiveEditorToDisk: mock.flush }));
import { useEditorWorkspaceTabs } from '../src/components/app/useEditorWorkspaceTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tabs: ReturnType<typeof useEditorWorkspaceTabs>;
const FILE = 'D:/isolated/chapter.md';
function Harness() {
  const [, setConfirmationCount] = useState(0);
  tabs = useEditorWorkspaceTabs({
    confirmAdditionalClose: mock.additionalClose,
    confirmAdditionalProjectChange: (action) => {
      setConfirmationCount((count) => count + 1);
      return mock.projectChange(action);
    },
    activeProject: 'D:/isolated',
    currentFile: FILE,
    selectProject: mock.selectProject,
    selectFile: () => undefined,
    closeFile: () => undefined,
    removeProject: mock.removeProject,
    onShowEditor: () => undefined,
    dialogs: {
      choose: mock.choose,
      confirm: mock.confirm,
      alert: mock.alert,
      prompt: async () => null,
    },
  });
  return null;
}
beforeEach(() => {
  mock.listener = null;
  vi.clearAllMocks();
  mock.choose.mockResolvedValue(null);
  mock.confirm.mockResolvedValue(false);
  mock.alert.mockResolvedValue(undefined);
  mock.flush.mockResolvedValue(undefined);
  mock.additionalClose.mockResolvedValue(true);
  mock.projectChange.mockResolvedValue(true);
});
async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  return () => {
    act(() => root.unmount());
    container.remove();
  };
}
async function close() {
  assert.ok(mock.listener, '原生关闭监听必须注册');
  const preventDefault = vi.fn();
  await act(async () => mock.listener!({ preventDefault }));
  return preventDefault;
}
test('干净窗口可退出，取消关闭保留脏稿，保存后允许退出', async () => {
  const cleanup = await mount();
  try {
    assert.equal((await close()).mock.calls.length, 0);
    act(() => tabs.handleEditorDirtyChange(FILE, true));
    assert.equal((await close()).mock.calls.length, 1);
    assert.equal(mock.choose.mock.calls[0][0].choices[0].label, '保存并退出应用');
    mock.choose.mockResolvedValue('save');
    assert.equal((await close()).mock.calls.length, 0);
    assert.deepEqual(mock.flush.mock.calls[0], [FILE, 15000]);
  } finally {
    cleanup();
  }
  assert.equal(mock.unlisten.mock.calls.length, 1);
});
test('保存失败禁止退出；明确放弃后可退出', async () => {
  const cleanup = await mount();
  try {
    act(() => tabs.handleEditorDirtyChange(FILE, true));
    mock.choose.mockResolvedValue('save');
    mock.flush.mockRejectedValue(new Error('disk write failed'));
    assert.equal((await close()).mock.calls.length, 1);
    assert.equal(mock.alert.mock.calls.length, 1);
    mock.choose.mockResolvedValue('discard');
    assert.equal((await close()).mock.calls.length, 0);
  } finally {
    cleanup();
  }
});
test('重复关闭只保留一个对话框，卸载后旧确认不得放行关闭', async () => {
  const cleanup = await mount();
  act(() => tabs.handleEditorDirtyChange(FILE, true));
  let resolve!: (value: string) => void;
  mock.choose.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  assert.ok(mock.listener);
  const firstPrevent = vi.fn();
  let pending!: Promise<void>;
  act(() => {
    pending = mock.listener!({ preventDefault: firstPrevent });
  });
  assert.equal((await close()).mock.calls.length, 1);
  assert.equal(mock.choose.mock.calls.length, 1);
  cleanup();
  await act(async () => {
    resolve('discard');
    await pending;
  });
  assert.equal(firstPrevent.mock.calls.length, 1);
});
test('后台脏文件也必须确认，不能假装保存活动文件就退出', async () => {
  const cleanup = await mount();
  try {
    act(() => {
      tabs.handleEditorDirtyChange(FILE, true);
      tabs.handleEditorDirtyChange('D:/isolated/other.md', true);
    });
    assert.equal((await close()).mock.calls.length, 1);
    assert.equal(mock.confirm.mock.calls[0][0].message.includes('2 个文件'), true);
    assert.equal(mock.flush.mock.calls.length, 0);
  } finally {
    cleanup();
  }
});

test('未发送消息取消退出时不开始正文保存，重新关闭仍可重试', async () => {
  const cleanup = await mount();
  try {
    act(() => tabs.handleEditorDirtyChange(FILE, true));
    mock.additionalClose.mockResolvedValue(false);
    assert.equal((await close()).mock.calls.length, 1);
    assert.equal(mock.choose.mock.calls.length, 0);
    assert.equal(mock.flush.mock.calls.length, 0);
    mock.additionalClose.mockResolvedValue(true);
    mock.choose.mockResolvedValue('discard');
    assert.equal((await close()).mock.calls.length, 0);
    assert.equal(mock.additionalClose.mock.calls.length, 2);
  } finally {
    cleanup();
  }
});
test('明确放弃消息后仍须通过正文确认，正文取消仍保留窗口', async () => {
  const cleanup = await mount();
  try {
    act(() => tabs.handleEditorDirtyChange(FILE, true));
    mock.additionalClose.mockResolvedValue(true);
    mock.choose.mockResolvedValue(null);
    assert.equal((await close()).mock.calls.length, 1);
    assert.equal(mock.additionalClose.mock.calls.length, 1);
    assert.equal(mock.choose.mock.calls.length, 1);
  } finally {
    cleanup();
  }
});

test('项目切换先确认消息；取消不丢页签，也不开始正文确认', async () => {
  const cleanup = await mount();
  try {
    await act(async () => tabs.openFile(FILE));
    act(() => tabs.handleEditorDirtyChange(FILE, true));
    mock.projectChange.mockResolvedValue(false);
    let selected = true;
    await act(async () => {
      selected = await tabs.selectProjectSafely('D:/next');
    });
    assert.equal(selected, false);
    assert.deepEqual(tabs.openFiles, [FILE]);
    assert.equal(tabs.dirtyFiles.has(FILE), true);
    assert.equal(mock.selectProject.mock.calls.length, 0);
    assert.equal(mock.choose.mock.calls.length, 0);
  } finally {
    cleanup();
  }
});

test('选择当前项目不确认、不重置工作区', async () => {
  const cleanup = await mount();
  try {
    await act(async () => tabs.openFile(FILE));
    await act(async () => tabs.selectProjectSafely('D:/isolated'));
    assert.deepEqual(tabs.openFiles, [FILE]);
    assert.equal(mock.projectChange.mock.calls.length, 0);
    assert.equal(mock.selectProject.mock.calls.length, 0);
  } finally {
    cleanup();
  }
});

test('移除后台项目不影响草稿；移除当前项目必须获得消息确认', async () => {
  const cleanup = await mount();
  try {
    await act(async () => tabs.openFile(FILE));
    mock.projectChange.mockResolvedValue(false);
    await act(async () => tabs.removeProjectSafely('D:/background'));
    assert.equal(mock.projectChange.mock.calls.length, 0);
    await act(async () => tabs.removeProjectSafely('D:/isolated'));
    assert.deepEqual(mock.removeProject.mock.calls, [['D:/background']]);
    assert.deepEqual(tabs.openFiles, [FILE]);
  } finally {
    cleanup();
  }
});

test('消息确认后正文取消仍保留项目；再次明确同意才切换', async () => {
  const cleanup = await mount();
  try {
    await act(async () => tabs.openFile(FILE));
    act(() => tabs.handleEditorDirtyChange(FILE, true));
    await act(async () => tabs.selectProjectSafely('D:/next'));
    assert.equal(mock.projectChange.mock.calls.length, 1);
    assert.equal(mock.selectProject.mock.calls.length, 0);
    mock.choose.mockResolvedValue('discard');
    await act(async () => tabs.selectProjectSafely('D:/next'));
    assert.deepEqual(mock.selectProject.mock.calls, [['D:/next']]);
    assert.deepEqual(tabs.openFiles, []);
  } finally {
    cleanup();
  }
});

test('项目导航重复点击不叠确认，卸载后的确认不执行切换', async () => {
  const cleanup = await mount();
  let resolve!: (approved: boolean) => void;
  mock.projectChange.mockReturnValue(
    new Promise<boolean>((done) => {
      resolve = done;
    }),
  );
  let pending!: Promise<boolean>;
  act(() => {
    pending = tabs.selectProjectSafely('D:/next');
  });
  await act(async () => tabs.removeProjectSafely('D:/isolated'));
  assert.equal(mock.projectChange.mock.calls.length, 1);
  cleanup();
  resolve(true);
  assert.equal(await pending, false);
  assert.equal(mock.selectProject.mock.calls.length, 0);
  assert.equal(mock.removeProject.mock.calls.length, 0);
});

test('消息确认失败保留页签并显示错误，重试仍可切换', async () => {
  const cleanup = await mount();
  try {
    await act(async () => tabs.openFile(FILE));
    mock.projectChange.mockRejectedValueOnce(new Error('confirmation failed'));
    await act(async () => tabs.selectProjectSafely('D:/next'));
    assert.deepEqual(tabs.openFiles, [FILE]);
    assert.equal(mock.selectProject.mock.calls.length, 0);
    assert.equal(mock.alert.mock.calls.length, 1);
    await act(async () => tabs.selectProjectSafely('D:/next'));
    assert.equal(mock.selectProject.mock.calls.length, 1);
  } finally {
    cleanup();
  }
});

test('弹窗重渲染改变回调引用，不应把有效项目确认判作过期', async () => {
  const cleanup = await mount();
  try {
    let resolve!: (approved: boolean) => void;
    mock.projectChange.mockReturnValueOnce(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    let pending!: Promise<boolean>;
    act(() => {
      pending = tabs.selectProjectSafely('D:/next');
    });
    await act(async () => {
      resolve(true);
      await pending;
    });
    assert.deepEqual(mock.selectProject.mock.calls, [['D:/next']]);
  } finally {
    cleanup();
  }
});
