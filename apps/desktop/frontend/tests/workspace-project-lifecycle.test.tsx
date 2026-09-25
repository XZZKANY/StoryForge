import assert from 'node:assert/strict';
import { act, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useEditorWorkspaceTabs } from '../src/components/app/useEditorWorkspaceTabs';
import { useProjectWorkspace } from '../src/components/app/useProjectWorkspace';
import { useSessionRestore } from '../src/components/app/useSessionRestore';
import { RECENT_PROJECTS_KEY } from '../src/components/app/helpers';
import { TauriFileSystem } from '../src/lib/tauri-fs';
import { parseWorkspaceSession, type WorkspaceSession } from '../src/lib/workspace-session';

vi.mock('../src/lib/tauri-env', () => ({ isTauriRuntime: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const SESSION_KEY = 'storyforge:workspace-session';
const saved: WorkspaceSession = {
  project: 'P',
  openFiles: ['P/正文/01.md', 'P/大纲/总纲.md', 'P/正文/已删除.md'],
  activeFile: 'P/正文/01.md',
  cursors: {
    'P/正文/01.md': { line: 14, column: 3 },
    'P/大纲/总纲.md': { line: 6, column: 1 },
    'P/正文/已删除.md': { line: 2, column: 1 },
  },
};
const mounted: Array<() => void> = [];
const noop = () => undefined;
const dialogs = {
  alert: async () => undefined,
  confirm: async () => false,
  choose: async () => null,
  prompt: async () => null,
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
});
afterEach(() => {
  mounted.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
}

function mountHook<T>(useValue: () => T, strict = false) {
  let value: T;
  function Probe() {
    const result = useValue();
    useEffect(() => {
      value = result;
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      strict ? (
        <StrictMode>
          <Probe />
        </StrictMode>
      ) : (
        <Probe />
      ),
    ),
  );
  let live = true;
  const cleanup = () => {
    if (!live) return;
    live = false;
    act(() => root.unmount());
    container.remove();
  };
  mounted.push(cleanup);
  return {
    get value() {
      return value;
    },
    cleanup,
  };
}

function mountDeferred({ enabled = true } = {}) {
  const selected: string[] = [];
  const hook = mountHook(() => {
    const session = useSessionRestore({
      enabled,
      deferUntilProjectSelected: true,
      selectProject: (path) => selected.push(path),
    });
    useEffect(() => session.persistSession(null, [], null));
    return session;
  });
  return { hook, selected };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test('作品库启动仅保存恢复快照：不自动导航、校验或用空现场清档，取消选择也不改变存档', async () => {
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(true);
  const { hook, selected } = mountDeferred();
  await settle();
  assert.deepEqual(selected, []);
  assert.equal(exists.mock.calls.length, 0);
  assert.equal(hook.value.pendingRestore, null);
  assert.equal(hook.value.openingProject, null);
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), saved);
  // 目录选择器取消不调用 selectProjectManually；随后一个持久化周期也必须保留快照。
  act(() => hook.value.persistSession(null, [], null));
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), saved);
});

test('选中存档作品后通过真实 workspace/tabs owner 恢复有效页签、正文和光标，完成前不抹档', async () => {
  const check = deferred<boolean>();
  vi.spyOn(TauriFileSystem, 'pathExists').mockImplementation(async (path) =>
    path === saved.project ? check.promise : path !== 'P/正文/已删除.md',
  );
  const hook = mountHook(() => {
    const workspace = useProjectWorkspace({ onProjectSelected: noop, onFileSelected: noop });
    const session = useSessionRestore({
      enabled: true,
      deferUntilProjectSelected: true,
      selectProject: workspace.selectProject,
    });
    const tabs = useEditorWorkspaceTabs({
      activeProject: workspace.activeProject,
      currentFile: workspace.currentFile,
      selectProject: session.selectProjectManually,
      selectFile: workspace.selectFile,
      closeFile: workspace.closeFile,
      removeProject: workspace.removeProject,
      dialogs,
      onShowEditor: noop,
      pendingRestore: session.pendingRestore,
      onRestoreApplied: session.handleRestoreApplied,
    });
    useEffect(() =>
      session.persistSession(workspace.activeProject, tabs.openFiles, workspace.currentFile),
    );
    return { workspace, session, tabs };
  });
  act(() => hook.value.session.selectProjectManually('P'));
  assert.equal(hook.value.session.openingProject, 'P');
  assert.equal(hook.value.workspace.activeProject, null);
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), saved);
  await act(async () => {
    check.resolve(true);
    await Promise.resolve();
  });
  assert.equal(hook.value.workspace.activeProject, 'P');
  assert.equal(hook.value.workspace.currentFile, 'P/正文/01.md');
  assert.deepEqual(hook.value.tabs.openFiles, ['P/正文/01.md', 'P/大纲/总纲.md']);
  assert.equal(hook.value.session.openingProject, null);
  assert.equal(hook.value.session.pendingRestore, null, '由真实页签层完成确认');
  assert.deepEqual(hook.value.session.initialCursors, {
    'P/正文/01.md': { line: 14, column: 3 },
    'P/大纲/总纲.md': { line: 6, column: 1 },
  });
  assert.deepEqual(
    parseWorkspaceSession(localStorage.getItem(SESSION_KEY))?.openFiles,
    hook.value.tabs.openFiles,
  );
});

test('同一帧重复选择存档作品只启动一组校验；旧 persist callback 不能提前清掉存档', async () => {
  const check = deferred<boolean>();
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockReturnValue(check.promise);
  const { hook, selected } = mountDeferred();
  act(() => {
    hook.value.selectProjectManually('P');
    hook.value.selectProjectManually('P');
    hook.value.persistSession(null, [], null);
  });
  assert.equal(exists.mock.calls.length, saved.openFiles.length + 1);
  assert.deepEqual(selected, []);
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), saved);
  await act(async () => {
    check.resolve(true);
    await Promise.resolve();
  });
  assert.deepEqual(selected, ['P']);
  assert.equal(hook.value.pendingRestore?.activeFile, saved.activeFile);
});

test('deferred A 校验期间选 B 再选 A，第一代迟到结果不能恢复旧页签或覆盖新选择', async () => {
  const check = deferred<boolean>();
  vi.spyOn(TauriFileSystem, 'pathExists').mockReturnValue(check.promise);
  const { hook, selected } = mountDeferred();
  act(() => hook.value.selectProjectManually('P'));
  act(() => hook.value.selectProjectManually('B'));
  act(() => hook.value.selectProjectManually('P'));
  assert.deepEqual(selected, ['B', 'P']);
  await act(async () => {
    check.resolve(true);
    await Promise.resolve();
  });
  assert.deepEqual(selected, ['B', 'P']);
  assert.equal(hook.value.pendingRestore, null);
  assert.equal(hook.value.initialCursors, null);
  assert.equal(hook.value.openingProject, null);
});

test('deferred 校验后卸载，迟到结果及保留的手动回调不能再导航', async () => {
  const check = deferred<boolean>();
  vi.spyOn(TauriFileSystem, 'pathExists').mockReturnValue(check.promise);
  const { hook, selected } = mountDeferred();
  act(() => hook.value.selectProjectManually('P'));
  const staleSelect = hook.value.selectProjectManually;
  hook.cleanup();
  staleSelect('B');
  await act(async () => {
    check.resolve(true);
    await Promise.resolve();
  });
  assert.deepEqual(selected, []);
});

test('deferred 校验失败留在库中并保留快照，可以重试；大纲 active 不冒充正文', async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...saved, activeFile: 'P/大纲/总纲.md' }));
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockImplementation(async (path) => {
    if (path === 'P') throw new Error('permission denied');
    return true;
  });
  const { hook, selected } = mountDeferred();
  act(() => hook.value.selectProjectManually('P'));
  await settle();
  assert.equal(hook.value.restoreIssue?.kind, 'check-failed');
  assert.equal(hook.value.openingProject, null);
  assert.deepEqual(selected, []);
  assert.equal(parseWorkspaceSession(localStorage.getItem(SESSION_KEY))?.project, 'P');
  exists.mockResolvedValue(true);
  act(() => hook.value.selectProjectManually('P'));
  await settle();
  assert.equal(hook.value.restoreIssue, null);
  assert.deepEqual(selected, ['P']);
  assert.equal(hook.value.pendingRestore?.activeFile, null);
  assert.deepEqual(hook.value.pendingRestore?.cursors, saved.cursors);
});

test('关闭恢复选项时 deferred 不恢复旧现场，手动选择保持原有打开流程', async () => {
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(true);
  const { hook, selected } = mountDeferred({ enabled: false });
  await settle();
  assert.equal(localStorage.getItem(SESSION_KEY), null);
  act(() => hook.value.selectProjectManually('P'));
  assert.deepEqual(selected, ['P']);
  assert.equal(exists.mock.calls.length, 0);
  assert.equal(hook.value.pendingRestore, null);
});

test('recent 恢复过滤非字符串、空字符串及重复值，不把无效值交给文件系统', async () => {
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(['A', null, '', '  ', 42, 'A', 'B']));
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(true);
  const hook = mountHook(() =>
    useProjectWorkspace({ onProjectSelected: noop, onFileSelected: noop }),
  );
  await settle();
  assert.deepEqual(hook.value.projects, ['A', 'B']);
  assert.deepEqual(
    exists.mock.calls.map(([path]) => path),
    ['A', 'B'],
  );
});

test('recent 初始校验迟到不覆盖期间新项目、删除和新排序，也不删刚重新创建的旧路径', async () => {
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(['A', 'B', 'C', 'D']));
  const check = deferred<boolean>();
  vi.spyOn(TauriFileSystem, 'pathExists').mockImplementation(async (path) =>
    path === 'D' ? check.promise : path !== 'C',
  );
  const hook = mountHook(() =>
    useProjectWorkspace({ onProjectSelected: noop, onFileSelected: noop }),
  );
  act(() => {
    hook.value.removeProject('A');
    hook.value.selectProject('NEW');
    hook.value.selectProject('B');
    hook.value.selectProject('C'); // 旧检查 C=false；之后创建成功并选中，不能被旧结果再删掉。
  });
  await act(async () => {
    check.resolve(true);
    await Promise.resolve();
  });
  assert.deepEqual(hook.value.projects, ['C', 'B', 'NEW', 'D']);
  assert.deepEqual(
    JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? '[]'),
    hook.value.projects,
  );
  assert.equal(hook.value.activeProject, 'C');
});

test('StrictMode 的启停重放不会提前恢复作品，也不会让一次显式选择重复导航', async () => {
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockResolvedValue(true);
  const selected: string[] = [];
  const hook = mountHook(
    () =>
      useSessionRestore({
        enabled: true,
        deferUntilProjectSelected: true,
        selectProject: (path) => selected.push(path),
      }),
    true,
  );
  await settle();
  assert.deepEqual(selected, []);
  assert.equal(exists.mock.calls.length, 0);
  act(() => hook.value.selectProjectManually('P'));
  await settle();
  assert.deepEqual(selected, ['P']);
  assert.equal(exists.mock.calls.length, saved.openFiles.length + 1);
});

test('缺失的存档作品不被选中，保留原存档并允许重试，而不是退化成空现场', async () => {
  vi.spyOn(TauriFileSystem, 'pathExists').mockImplementation(async (path) => path !== 'P');
  const { hook, selected } = mountDeferred();
  act(() => hook.value.selectProjectManually('P'));
  await settle();
  assert.equal(hook.value.restoreIssue?.kind, 'missing-project');
  assert.equal(hook.value.openingProject, null);
  assert.deepEqual(selected, []);
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), saved);
});

test('recent 校验异常保守保留；卸载后旧结果不改写持久化最近列表', async () => {
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(['A', 'B']));
  const check = deferred<boolean>();
  const exists = vi.spyOn(TauriFileSystem, 'pathExists').mockImplementation(async (path) => {
    if (path === 'A') throw new Error('temporarily unavailable');
    return check.promise;
  });
  const hook = mountHook(() =>
    useProjectWorkspace({ onProjectSelected: noop, onFileSelected: noop }),
  );
  await act(async () => {
    check.resolve(false);
    await Promise.resolve();
  });
  assert.deepEqual(hook.value.projects, ['A']);
  const late = deferred<boolean>();
  exists.mockReturnValue(late.promise);
  const second = mountHook(() =>
    useProjectWorkspace({ onProjectSelected: noop, onFileSelected: noop }),
  );
  second.cleanup();
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(['OTHER']));
  await act(async () => {
    late.resolve(false);
    await Promise.resolve();
  });
  assert.deepEqual(JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? '[]'), ['OTHER']);
});

test('显式取消在途恢复同步失效旧回调，保留快照并允许同帧重新选择', async () => {
  const first = deferred<boolean>();
  const second = deferred<boolean>();
  let projectChecks = 0;
  vi.spyOn(TauriFileSystem, 'pathExists').mockImplementation(async (path) => {
    if (path !== 'P') return true;
    projectChecks += 1;
    return projectChecks === 1 ? first.promise : second.promise;
  });
  const { hook, selected } = mountDeferred();
  act(() => {
    hook.value.selectProjectManually('P');
    hook.value.cancelPendingNavigation();
    hook.value.persistSession(null, [], null);
  });
  assert.equal(hook.value.openingProject, null);
  assert.deepEqual(parseWorkspaceSession(localStorage.getItem(SESSION_KEY)), saved);
  act(() => hook.value.selectProjectManually('P'));
  await act(async () => {
    first.resolve(true);
    await Promise.resolve();
  });
  assert.deepEqual(selected, []);
  assert.equal(hook.value.openingProject, 'P', '旧 finally 不得清掉第二次打开提示');
  await act(async () => {
    second.resolve(true);
    await Promise.resolve();
  });
  assert.deepEqual(selected, ['P']);
  assert.deepEqual(hook.value.pendingRestore?.cursors, saved.cursors);
  const pending = hook.value.pendingRestore;
  act(() => hook.value.cancelPendingNavigation());
  assert.equal(
    hook.value.pendingRestore,
    pending,
    '已选项目等待真实页签落地不属于在途检查，不能被取消',
  );
  act(() => hook.value.handleRestoreApplied());
  act(() => hook.value.cancelPendingNavigation());
  assert.equal(hook.value.restoredWorkspace, true, '正常已恢复现场不受回库取消 API 影响');
});
