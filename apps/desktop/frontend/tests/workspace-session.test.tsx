/**
 * 恢复现场（写作时刻 01）。
 *
 * 除了纯函数的容错，这里钉死一条真正危险的时序不变量：
 * **恢复完成之前不许回写会话**。启动瞬间 openFiles 还是空的，若此时就落盘，
 * 存进去的是一个空现场 —— 作者下次打开会发现页签全没了，而且原始会话已被自己覆盖，无从找回。
 */
import assert from 'node:assert/strict';
import { useEffect } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test } from 'vitest';

import { useSessionRestore } from '../src/components/app/useSessionRestore';
import {
  isWorthPersisting,
  parseWorkspaceSession,
  pruneCursors,
  reconcileWorkspaceSession,
  type WorkspaceSession,
} from '../src/lib/workspace-session';

const SESSION_KEY = 'storyforge:workspace-session';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ container: HTMLElement; root: ReturnType<typeof createRoot> }> = [];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  while (mounted.length) {
    const instance = mounted.pop();
    if (!instance) continue;
    act(() => instance.root.unmount());
    instance.container.remove();
  }
  delete (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__;
});

// ---------- 纯函数 ----------

test('脏 JSON / 缺字段一律退化成 null，不抛异常', () => {
  assert.equal(parseWorkspaceSession(null), null);
  assert.equal(parseWorkspaceSession('}{ not json'), null);
  assert.equal(parseWorkspaceSession('"a string"'), null);
  assert.equal(parseWorkspaceSession('{"openFiles":["a"]}'), null, '缺 project 即作废');

  const ok = parseWorkspaceSession(
    JSON.stringify({ project: 'P', openFiles: ['a', 42, 'b'], activeFile: 'a', cursors: null }),
  );
  assert.deepEqual(ok?.openFiles, ['a', 'b'], '非字符串路径被剔除');
  assert.deepEqual(ok?.cursors, {});
});

test('光标只接受 1-based 正整数，脏值静默丢弃', () => {
  const parsed = parseWorkspaceSession(
    JSON.stringify({
      project: 'P',
      openFiles: ['a'],
      cursors: { a: { line: 12, column: 3 }, b: { line: 0, column: 1 }, c: { line: 'x' } },
    }),
  );
  assert.deepEqual(parsed?.cursors, { a: { line: 12, column: 3 } });
});

test('项目没了整份作废；个别文件没了只摘那一条，activeFile 回落到剩余首个', () => {
  const session: WorkspaceSession = {
    project: 'P',
    openFiles: ['a', 'b', 'c'],
    activeFile: 'b',
    cursors: { a: { line: 3, column: 1 }, b: { line: 9, column: 1 } },
  };

  assert.equal(
    reconcileWorkspaceSession(session, false, new Set(['a'])),
    null,
    '项目不在即整份作废',
  );

  const partial = reconcileWorkspaceSession(session, true, new Set(['a', 'c']));
  assert.deepEqual(partial?.openFiles, ['a', 'c'], '已删文件被摘掉');
  assert.equal(partial?.activeFile, 'a', 'activeFile 被摘掉后回落到剩余首个');
  assert.deepEqual(partial?.cursors, { a: { line: 3, column: 1 } }, '死路径的光标一并清掉');
});

test('光标表只留仍打开的文件，长期项目不会攒出一大坨死路径', () => {
  const cursors = { a: { line: 1, column: 1 }, b: { line: 2, column: 1 } };
  assert.deepEqual(pruneCursors(cursors, ['b']), { b: { line: 2, column: 1 } });
  assert.deepEqual(pruneCursors(cursors, []), {});
});

test('没有打开任何文件的会话不值得存', () => {
  assert.equal(isWorthPersisting(null), false);
  assert.equal(
    isWorthPersisting({ project: 'P', openFiles: [], activeFile: null, cursors: {} }),
    false,
  );
  assert.equal(
    isWorthPersisting({ project: 'P', openFiles: ['a'], activeFile: 'a', cursors: {} }),
    true,
  );
});

// ---------- 时序不变量 ----------

let sessionHandle: ReturnType<typeof useSessionRestore>;

function Harness({
  enabled,
  onSelectProject,
  persistWith,
}: {
  enabled: boolean;
  onSelectProject: (path: string) => void;
  // 模拟 App：每次渲染都按当前（启动瞬间为空的）现场回写一次
  persistWith: { project: string | null; openFiles: string[]; currentFile: string | null };
}) {
  const session = useSessionRestore({ enabled, selectProject: onSelectProject });
  sessionHandle = session;
  const { persistSession } = session;
  useEffect(() => {
    persistSession(persistWith.project, persistWith.openFiles, persistWith.currentFile);
  });
  return null;
}

function mount(element: React.ReactElement): void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  mounted.push({ container, root });
}

test('恢复落地之前的回写一律被挡住——否则启动即抹平现场', async () => {
  const stored: WorkspaceSession = {
    project: 'P',
    openFiles: ['P/a.md', 'P/b.md'],
    activeFile: 'P/b.md',
    cursors: { 'P/b.md': { line: 40, column: 2 } },
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: () => true,
  };

  const selected: string[] = [];
  // 关键：persistWith 全是启动瞬间的空值。没有 phase 守卫的话，这一次回写就会把会话清掉。
  mount(
    <Harness
      enabled
      onSelectProject={(path) => selected.push(path)}
      persistWith={{ project: null, openFiles: [], currentFile: null }}
    />,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.deepEqual(selected, ['P'], '应当发起恢复：selectProject 被调用到存档项目');
  const after = parseWorkspaceSession(localStorage.getItem(SESSION_KEY));
  assert.deepEqual(
    after?.openFiles,
    ['P/a.md', 'P/b.md'],
    '恢复尚未落地时回写必须被挡住，存档不能被空现场覆盖',
  );
  assert.deepEqual(after?.cursors, { 'P/b.md': { line: 40, column: 2 } }, '光标一并保住');
});

test('关掉「启动时恢复上次现场」则不读存档、并清掉它', async () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ project: 'P', openFiles: ['P/a.md'], activeFile: 'P/a.md', cursors: {} }),
  );
  const selected: string[] = [];
  mount(
    <Harness
      enabled={false}
      onSelectProject={(path) => selected.push(path)}
      persistWith={{ project: null, openFiles: [], currentFile: null }}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });

  assert.deepEqual(selected, [], '关闭时不应自动打开任何项目');
  assert.equal(localStorage.getItem(SESSION_KEY), null, '关闭后存档应被清掉，不留下会复活的现场');
});

test('手动打开项目优先于尚未完成的启动恢复，并允许保存新现场', async () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      project: 'P',
      openFiles: ['P/a.md'],
      activeFile: 'P/a.md',
      cursors: {},
    }),
  );
  let resolve!: (exists: boolean) => void;
  const pending = new Promise<boolean>((done) => {
    resolve = done;
  });
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: () => pending,
  };
  const selected: string[] = [];
  const onSelectProject = (path: string) => {
    selected.push(path);
  };
  mount(
    <Harness
      enabled
      onSelectProject={onSelectProject}
      persistWith={{ project: null, openFiles: [], currentFile: null }}
    />,
  );
  // 通过将由 App 的手动导航入口使用的 hook 方法，而非伪造“已取消”内部状态。
  act(() => sessionHandle.selectProjectManually('Q'));
  const latest = mounted[mounted.length - 1];
  act(() =>
    latest.root.render(
      <Harness
        enabled
        onSelectProject={onSelectProject}
        persistWith={{ project: 'Q', openFiles: ['Q/new.md'], currentFile: 'Q/new.md' }}
      />,
    ),
  );
  assert.equal(parseWorkspaceSession(localStorage.getItem(SESSION_KEY))?.project, 'Q');
  await act(async () => {
    resolve(true);
    await pending;
  });
  assert.deepEqual(selected, ['Q']);
  assert.equal(sessionHandle.pendingRestore, null);
  assert.equal(sessionHandle.initialCursors, null);
  assert.equal(sessionHandle.restoredWorkspace, false);
  assert.equal(parseWorkspaceSession(localStorage.getItem(SESSION_KEY))?.project, 'Q');
});

test('用户手动打开同一个项目也不应被旧恢复重新铺页签', async () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      project: 'P',
      openFiles: ['P/old.md'],
      activeFile: 'P/old.md',
      cursors: {},
    }),
  );
  let resolve!: (exists: boolean) => void;
  const pending = new Promise<boolean>((done) => {
    resolve = done;
  });
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: () => pending,
  };
  const selected: string[] = [];
  mount(
    <Harness
      enabled
      onSelectProject={(path) => selected.push(path)}
      persistWith={{ project: null, openFiles: [], currentFile: null }}
    />,
  );
  act(() => sessionHandle.selectProjectManually('P'));
  await act(async () => {
    resolve(true);
    await pending;
  });
  assert.deepEqual(selected, ['P']);
  assert.equal(sessionHandle.pendingRestore, null);
});

test('正常恢复可交还页签并持久化；之后手动导航不泄漏旧光标', async () => {
  const stored = {
    project: 'P',
    openFiles: ['P/a.md'],
    activeFile: 'P/a.md',
    cursors: { 'P/a.md': { line: 8, column: 2 } },
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: () => true,
  };
  const selected: string[] = [];
  mount(
    <Harness
      enabled
      onSelectProject={(path) => selected.push(path)}
      persistWith={{ project: 'P', openFiles: ['P/a.md'], currentFile: 'P/a.md' }}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  assert.deepEqual(selected, ['P']);
  assert.deepEqual(sessionHandle.pendingRestore?.openFiles, ['P/a.md']);
  act(() => sessionHandle.handleRestoreApplied());
  assert.deepEqual(
    parseWorkspaceSession(localStorage.getItem(SESSION_KEY))?.cursors,
    stored.cursors,
  );
  act(() => sessionHandle.selectProjectManually('Q'));
  assert.equal(sessionHandle.initialCursors, null);
  assert.equal(sessionHandle.restoredWorkspace, false);
});

test('手动导航后开关恢复选项不再抢回当前项目', async () => {
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: () => true,
  };
  const selected: string[] = [];
  const onSelectProject = (path: string) => {
    selected.push(path);
  };
  const persistWith = { project: 'Q', openFiles: ['Q/a.md'], currentFile: 'Q/a.md' };
  mount(<Harness enabled={false} onSelectProject={onSelectProject} persistWith={persistWith} />);
  act(() => sessionHandle.selectProjectManually('Q'));
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ project: 'P', openFiles: ['P/old.md'], activeFile: 'P/old.md', cursors: {} }),
  );
  act(() =>
    mounted[mounted.length - 1].root.render(
      <Harness enabled onSelectProject={onSelectProject} persistWith={persistWith} />,
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
  assert.deepEqual(selected, ['Q']);
  assert.equal(parseWorkspaceSession(localStorage.getItem(SESSION_KEY))?.project, 'Q');
});
