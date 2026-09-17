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

test('有项目但没有打开文件的会话仍值得存，用于重启回到作品总览', () => {
  assert.equal(isWorthPersisting(null), false);
  assert.equal(
    isWorthPersisting({ project: 'P', openFiles: [], activeFile: null, cursors: {} }),
    true,
  );
  assert.equal(
    isWorthPersisting({ project: 'P', openFiles: ['a'], activeFile: 'a', cursors: {} }),
    true,
  );
});

// ---------- 时序不变量 ----------

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
  const { persistSession } = session;
  useEffect(() => {
    persistSession(persistWith.project, persistWith.openFiles, persistWith.currentFile);
  });
  return null;
}

type RestoreControls = { selectProjectManually: (path: string) => void };

function ManualRestoreHarness({
  onSelectProject,
  controls,
}: {
  onSelectProject: (path: string) => void;
  controls: { current: RestoreControls | null };
}) {
  const session = useSessionRestore({ enabled: true, selectProject: onSelectProject });
  // effect 仅暴露测试控制，不参与产品逻辑。
  useEffect(() => {
    controls.current = { selectProjectManually: session.selectProjectManually };
    return () => {
      controls.current = null;
    };
  }, [controls, session.selectProjectManually]);
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

test('项目仍存在但没有可恢复页签时仍切入项目——由 App 展示作品总览', async () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      project: 'P',
      openFiles: ['P/deleted.md'],
      activeFile: 'P/deleted.md',
      cursors: {},
    }),
  );
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: (path: string) => path === 'P',
  };

  const selected: string[] = [];
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

  assert.deepEqual(
    selected,
    ['P'],
    '项目目录仍存在时，即使存档页签都失效，也应恢复项目并让上层进入作品总览',
  );
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

test('手动导航同步夺取恢复权：迟到的旧校验不得覆盖新项目', async () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      project: 'old-project',
      openFiles: ['old-project/正文/第01章.md'],
      activeFile: 'old-project/正文/第01章.md',
      cursors: { 'old-project/正文/第01章.md': { line: 8, column: 2 } },
    }),
  );
  let resolveProject!: (value: boolean) => void;
  let resolveFile!: (value: boolean) => void;
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: (path: string) =>
      path === 'old-project'
        ? new Promise<boolean>((resolve) => {
            resolveProject = resolve;
          })
        : new Promise<boolean>((resolve) => {
            resolveFile = resolve;
          }),
  };

  const selected: string[] = [];
  const controls: { current: RestoreControls | null } = { current: null };
  mount(
    <ManualRestoreHarness onSelectProject={(path) => selected.push(path)} controls={controls} />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  assert.ok(controls.current, '测试应能拿到手动导航入口');

  act(() => controls.current?.selectProjectManually('new-project'));
  assert.deepEqual(selected, ['new-project'], '手动项目应立即选中，不等待旧恢复 IO');

  await act(async () => {
    resolveProject(true);
    resolveFile(true);
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.deepEqual(selected, ['new-project'], '旧恢复结果迟到后不得再次选择存档项目');
});

test('activeFile 失效或落在大纲时不伪造章节，仍保留全部有效页签与光标', async () => {
  const stored: WorkspaceSession = {
    project: 'P',
    openFiles: ['P/正文/第01章.md', 'P/大纲/总纲.md'],
    activeFile: 'P/大纲/总纲.md',
    cursors: {
      'P/正文/第01章.md': { line: 4, column: 1 },
      'P/大纲/总纲.md': { line: 12, column: 3 },
    },
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: () => true,
  };
  let restored: WorkspaceSession | null = null;
  function Capture() {
    const session = useSessionRestore({ enabled: true, selectProject: () => undefined });
    useEffect(() => {
      if (session.pendingRestore) restored = session.pendingRestore;
    }, [session.pendingRestore]);
    return null;
  }
  mount(<Capture />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.deepEqual(restored?.openFiles, stored.openFiles);
  assert.equal(restored?.activeFile, null, '大纲不是可直接恢复的正文章节');
  assert.deepEqual(restored?.cursors, stored.cursors, '有效页签的光标不能因 active 失效而丢失');
});

test('activeFile 已删除时保留其他正文章节页签，但不回落到首个文件', async () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      project: 'P',
      openFiles: ['P/正文/第01章.md', 'P/正文/第02章.md'],
      activeFile: 'P/正文/已删除.md',
      cursors: {
        'P/正文/第01章.md': { line: 3, column: 1 },
        'P/正文/第02章.md': { line: 7, column: 2 },
      },
    }),
  );
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: (path: string) => path !== 'P/正文/已删除.md',
  };
  let restored: WorkspaceSession | null = null;
  function Capture() {
    const session = useSessionRestore({ enabled: true, selectProject: () => undefined });
    useEffect(() => {
      if (session.pendingRestore) restored = session.pendingRestore;
    }, [session.pendingRestore]);
    return null;
  }
  mount(<Capture />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.deepEqual(restored?.openFiles, ['P/正文/第01章.md', 'P/正文/第02章.md']);
  assert.equal(restored?.activeFile, null, '失效 active 不得回落到第一个正文章节');
  assert.deepEqual(restored?.cursors, {
    'P/正文/第01章.md': { line: 3, column: 1 },
    'P/正文/第02章.md': { line: 7, column: 2 },
  });
});

test('启动恢复项目失效或校验异常时提供明确只读问题，不误切项目', async () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ project: 'gone', openFiles: ['gone/正文/01.md'], activeFile: null }),
  );
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: (path: string) => path !== 'gone',
  };
  let issue: { kind?: string; message?: string } | null = null;
  let selected = false;
  function Capture() {
    const session = useSessionRestore({ enabled: true, selectProject: () => (selected = true) });
    useEffect(() => {
      if (session.restoreIssue) issue = session.restoreIssue;
    }, [session.restoreIssue]);
    return null;
  }
  mount(<Capture />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(selected, false);
  assert.equal(issue?.kind, 'missing-project');
  assert.match(issue?.message ?? '', /不存在/);
});

test('项目存在性检查抛错时保守停留当前界面并标记 check-failed', async () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ project: 'unreadable', openFiles: [], activeFile: null }),
  );
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: () => Promise.reject(new Error('permission denied')),
  };
  let issue: { kind?: string } | null = null;
  function Capture() {
    const session = useSessionRestore({ enabled: true, selectProject: () => undefined });
    useEffect(() => {
      if (session.restoreIssue) issue = session.restoreIssue;
    }, [session.restoreIssue]);
    return null;
  }
  mount(<Capture />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(issue?.kind, 'check-failed');
});

test('手动选择项目会清理旧恢复问题；未确认取消时不夺走自动恢复权', async () => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ project: 'gone', openFiles: ['gone/正文/01.md'], activeFile: null }),
  );
  (window as { __STORYFORGE_MOCK_FS__?: unknown }).__STORYFORGE_MOCK_FS__ = {
    pathExists: (path: string) => path !== 'gone',
  };
  const selected: string[] = [];
  const controls: {
    current: { selectProjectManually: (path: string) => void; getIssue: () => unknown } | null;
  } = { current: null };
  function Capture() {
    const session = useSessionRestore({
      enabled: true,
      selectProject: (path) => selected.push(path),
    });
    useEffect(() => {
      controls.current = {
        selectProjectManually: session.selectProjectManually,
        getIssue: () => session.restoreIssue,
      };
      return () => {
        controls.current = null;
      };
    }, [session.restoreIssue, session.selectProjectManually]);
    return null;
  }
  mount(<Capture />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal((controls.current?.getIssue() as { kind?: string } | null)?.kind, 'missing-project');
  act(() => controls.current?.selectProjectManually('gone'));
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(controls.current?.getIssue(), null, '手动接管后不应继续展示旧恢复错误');
  assert.deepEqual(selected, ['gone']);
});
