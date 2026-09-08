/**
 * 自动档写回红线：护栏打在接线上，不是只测纯函数。
 *
 * 本波把「补丁必须作者点接受」放宽成「自动档免点击」，放宽的只有那一层闸。这里钉死的是
 * 剩下没放宽的部分：谁能自动落盘、落盘前必须先存快照、快照失败必须阻断、派生缓存永不自动写；
 * 以及事后反悔那一侧——撤销一次「新建」要删文件而不是留个空文件，撤销失效也不能是死路。
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test, vi } from 'vitest';

const writes: Array<{ path: string; content: string }> = [];
const deletes: string[] = [];
const writeRoots: string[] = [];
const records: RevisionLoopRecord[] = [];
const droppedTabs: string[] = [];
const calls: string[] = [];
let snapshotFails = false;
let snapshotGate: Promise<void> | null = null;
const branchTargets: Array<BranchHeadTarget | undefined> = [];
let snapshotCreated = false;
let versionHistoryOpened = 0;
let noteWriteGate: Promise<void> | null = null;
let manuscriptWriteGate: Promise<void> | null = null;
let latest: ReturnType<typeof useSuggestionWriteback>;

vi.mock('../../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    writeFile: async (_root: string, path: string, content: string) => {
      calls.push('write');
      writeRoots.push(_root);
      writes.push({ path, content });
      if (path.includes('/.storyforge/notes/')) await noteWriteGate;
      else await manuscriptWriteGate;
    },
    deletePath: async (_root: string, path: string) => {
      calls.push('delete');
      deletes.push(path);
    },
  },
}));

vi.mock('../../src/lib/versions', () => ({
  snapshotBeforeWrite: async () => {
    calls.push('snapshot');
    if (snapshotFails) throw new Error('快照写入失败');
    await snapshotGate;
    return { path: '/snapshot.md', timestamp: 1, created: snapshotCreated };
  },
}));

/** 接受补丁后会回调后端标连载计划；不 mock 就会打真 fetch。 */
const planMarkArgs: Array<Record<string, unknown>> = [];
let planMarkFails = false;
vi.mock('../../src/lib/api/ide-commands', () => ({
  executeIdeCommand: async (commandId: string, args: Record<string, unknown>) => {
    calls.push(`command:${commandId}`);
    planMarkArgs.push(args);
    if (planMarkFails) throw new Error('计划标记失败');
    return { payload: { plan: { updated: true, ordinal: 1, next_ordinal: 2 } } };
  },
}));

import { emitFileSuggestion } from '../../src/lib/assistant-events';
import { buildPatchHunks, applyPatchHunkToCurrent } from '../../src/lib/patch-hunks';
import type { RevisionLoopRecord } from '../../src/lib/author-loop';
import type { BranchHeadTarget } from '../../src/lib/branches';
import { TOAST_EVENT, type ToastAction, type ToastDetail } from '../../src/lib/toast';
import { useSuggestionWriteback } from '../../src/components/editor/useSuggestionWriteback';

const PROJECT = 'D:/连载/末世吞噬';
const FILE = 'D:/连载/末世吞噬/正文/第01章.md';
const BEFORE = '旧的一章。';
const AFTER = '新的一章。';

/** 编辑器当前正文——测试要在写回之后改动它，模拟「作者又接着写了」。 */
let editorContent = BEFORE;
const toasts: ToastDetail[] = [];

function Harness({ filePath, projectPath = PROJECT }: { filePath: string; projectPath?: string }) {
  const editorRef = useRef({
    getValue: () => editorContent,
    getModel: () => null,
    focus: () => {
      calls.push('focus');
    },
  } as never);
  const originalContentRef = useRef(BEFORE);
  const cleanVersionIdRef = useRef<number | null>(null);
  const filePathRef = useRef<string | null>(filePath);
  const projectPathRef = useRef<string | null>(PROJECT);
  const modelCacheRef = useRef(new Map());
  filePathRef.current = filePath;
  projectPathRef.current = projectPath;

  latest = useSuggestionWriteback({
    editorRef,
    originalContentRef,
    cleanVersionIdRef,
    filePathRef,
    projectPathRef,
    modelCacheRef: modelCacheRef as never,
    setLoadedContentPreview: () => undefined,
    setIsDirty: () => undefined,
    normalizeEol: (text: string) => text.replace(/\r\n/g, '\n'),
    getActiveBranchSnapshot: () => ({ id: 'main', label: '主线', headNodeId: null }) as never,
    advanceBranchHead: async (_timestamp, target) => {
      calls.push('branch');
      branchTargets.push(target);
    },
    recordRevisionLoop: async (record) => {
      calls.push('record');
      records.push(record);
      return { recordPath: '/loop.md' } as never;
    },
    emitAuthorLoopResult: () => undefined,
    dropOpenFilePath: (path: string) => droppedTabs.push(path),
    onRequestVersionHistory: () => {
      versionHistoryOpened += 1;
    },
  });

  return null;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'patch-1',
    filePath: FILE,
    title: 'AI 修订',
    summary: '改了第一章',
    before: BEFORE,
    after: AFTER,
    note: '用户意图：改稿',
    createdAt: 1,
    ...overrides,
  } as never;
}

/** 取最后一条带动作的通知——撤销入口就挂在那上面。 */
function lastActionableToast(): ToastAction {
  const found = [...toasts].reverse().find((toast) => toast.action);
  assert.ok(
    found?.action,
    `没有任何带动作的通知，实际：${toasts.map((t) => t.message).join(' | ')}`,
  );
  return found.action;
}

function onToast(event: Event) {
  toasts.push((event as CustomEvent<ToastDetail>).detail);
}

beforeEach(() => {
  noteWriteGate = null;
  manuscriptWriteGate = null;
  writes.length = 0;
  writeRoots.length = 0;
  records.length = 0;
  deletes.length = 0;
  droppedTabs.length = 0;
  calls.length = 0;
  toasts.length = 0;
  snapshotFails = false;
  snapshotGate = null;
  branchTargets.length = 0;
  snapshotCreated = false;
  planMarkArgs.length = 0;
  planMarkFails = false;
  versionHistoryOpened = 0;
  editorContent = BEFORE;
  window.addEventListener(TOAST_EVENT, onToast);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness filePath={FILE} />);
  });
});

afterEach(() => {
  window.removeEventListener(TOAST_EVENT, onToast);
  act(() => {
    root.unmount();
  });
  container.remove();
});

test('接受补丁后回调连载计划标 done，且发生在版本记录之后', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });

  assert.deepEqual(
    planMarkArgs,
    [{ project_root: PROJECT, file_path: FILE }],
    '正文落盘后必须回调一次 plan.mark_written，且把项目根与目标文件如实带上',
  );
  assert.equal(
    calls.indexOf('record') < calls.indexOf('command:plan.mark_written'),
    true,
    `标 done 必须在版本记录之后，实际顺序：${calls.join(' → ')}`,
  );
});

test('询问档补丁还没被接受时，绝不回调标 done', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });

  assert.deepEqual(planMarkArgs, [], '补丁还挂着等作者，正文没落盘，不能去标 done');
});

test('快照失败阻断写盘时，也不回调标 done', async () => {
  snapshotFails = true;

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });

  assert.deepEqual(planMarkArgs, [], '写盘被阻断就没有「写完一章」这回事');
});

test('标 done 失败不能伪造成「接受失败」——正文其实已经写进去了', async () => {
  planMarkFails = true;

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });

  assert.deepEqual(writes, [{ path: FILE, content: AFTER }], '写回本身必须照常成功');
  const failed = toasts.filter((toast) => toast.tone === 'error');
  assert.deepEqual(
    failed,
    [],
    `回调失败只能吞掉，不该弹错误通知，实际：${failed.map((t) => t.message).join(' | ')}`,
  );
});

test('撤销一次新建后回调把该章退回 pending，且发生在删文件之后', async () => {
  snapshotCreated = true;

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  editorContent = AFTER;
  planMarkArgs.length = 0;
  calls.length = 0;

  await act(async () => {
    await lastActionableToast().run();
  });

  assert.deepEqual(deletes, [FILE], '撤销新建应当删文件');
  assert.deepEqual(
    planMarkArgs,
    [{ project_root: PROJECT, file_path: FILE }],
    '正文没了，必须回调一次 plan.unmark_written',
  );
  assert.equal(
    calls.indexOf('delete') < calls.indexOf('command:plan.unmark_written'),
    true,
    `退标记必须在删文件之后，实际顺序：${calls.join(' → ')}`,
  );
});

test('撤销一次普通修订不退标记——文件还在，那章依然是写完的', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  editorContent = AFTER;
  planMarkArgs.length = 0;
  calls.length = 0;

  await act(async () => {
    await lastActionableToast().run();
  });

  assert.deepEqual(deletes, [], '普通修订的撤销是反向写回，不删文件');
  assert.deepEqual(
    calls.filter((call) => call.startsWith('command:')),
    [],
    '文件还在，不该去退标记（正向回调也只挂在接受整个补丁那一层）',
  );
});

test('自动档：补丁不必点接受就落盘，且顺序仍是先快照后写盘', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });

  assert.deepEqual(
    writes,
    [{ path: FILE, content: AFTER }],
    '自动档补丁应当无需任何点击就写到目标文件',
  );
  assert.equal(calls.indexOf('snapshot') >= 0, true, '写盘前必须存快照');
  assert.equal(
    calls.indexOf('snapshot') < calls.indexOf('write'),
    true,
    `快照必须发生在写盘之前，实际顺序：${calls.join(' → ')}`,
  );
});

test('询问档：补丁只挂起等作者，绝不自己落盘', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: true }));
  });

  assert.deepEqual(writes, [], '询问档不得在没有作者确认时写盘');
});

test('确认位缺失（老后端 / 坏数据）一律退回手动确认', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion());
  });

  assert.deepEqual(writes, [], '缺少 requiresConfirmation 时必须失败关闭');
});

test('自动档下快照失败仍然阻断写盘', async () => {
  snapshotFails = true;

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });

  assert.deepEqual(writes, [], '快照失败时绝不能落盘');
  assert.equal(calls.includes('record'), false, '快照失败后也不该记录闭环');
});

test('撤销一次「新建」是删掉文件并摘页签，不是写回一个空文件', async () => {
  snapshotCreated = true;
  editorContent = '';

  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false, before: '', after: AFTER }));
  });
  assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);

  editorContent = AFTER;
  const undo = lastActionableToast();
  assert.match(undo.label, /删除/, '新建的撤销按钮要说清楚会删文件');

  await act(async () => {
    await undo.run();
  });

  assert.deepEqual(deletes, [FILE], '撤销新建必须真的把文件删掉');
  assert.deepEqual(droppedTabs, [FILE], '页签要一起摘掉，否则 autosave 会把文件写回来');
  assert.equal(writes.length, 1, '撤销新建不得再写一次空内容');
});

test('撤销一次普通修订仍是写回原文，不碰删除', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });

  editorContent = AFTER;
  await act(async () => {
    await lastActionableToast().run();
  });

  assert.deepEqual(deletes, [], '普通修订的撤销不该删文件');
  assert.deepEqual(writes[1], { path: FILE, content: BEFORE }, '应把原文写回去');
});

test('文件之后又变了：撤销不再是死路，给出版本历史入口', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });

  // 作者在写回之后又接着写了——此时一键撤销会吃掉这段新输入。
  editorContent = `${AFTER}\n作者后来又写的一段。`;
  await act(async () => {
    await lastActionableToast().run();
  });

  assert.equal(writes.length, 1, '内容已变时绝不能覆盖作者的新输入');
  assert.deepEqual(deletes, []);

  const fallback = lastActionableToast();
  assert.match(fallback.label, /版本历史/, '撤销失效后要给去处，而不是只报个错');
  await act(async () => {
    await fallback.run();
  });
  assert.equal(versionHistoryOpened, 1, '点它应当真的打开版本历史');
});

for (const replacement of ['new-id', 'same-id', 'none']) {
  test(`保存旧旁注晚完成不会关闭新提议：${replacement}`, async () => {
    await act(async () => {
      emitFileSuggestion(suggestion({ requiresConfirmation: true }));
    });
    let finish!: () => void;
    noteWriteGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let saving!: Promise<void>;
    act(() => {
      saving = latest.handleSaveSuggestionNote();
    });
    if (replacement !== 'none')
      await act(async () => {
        emitFileSuggestion(
          suggestion({
            id: replacement === 'new-id' ? 'patch-B' : 'patch-1',
            after: '后来打开的另一版',
            requiresConfirmation: true,
          }),
        );
      });
    await act(async () => {
      finish();
      await saving;
    });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    if (replacement === 'none') {
      assert.equal(latest.pendingSuggestion === null, true);
      assert.equal(calls.includes('focus'), true);
    } else {
      assert.equal(latest.pendingSuggestion?.after, '后来打开的另一版');
      assert.equal(calls.includes('focus'), false);
    }
    assert.equal(writes.length, 1);
    assert.match(writes[0].path, /\.storyforge\/notes\//);
    assert.match(writes[0].content, /新的一章/);
  });
}

for (const change of ['file', 'suggestion', 'selection', 'none']) {
  test(`回编辑器焦点帧不得跨越后续用户上下文：${change}`, async () => {
    const frames: FrameRequestCallback[] = [];
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const panel = document.createElement('div');
    panel.dataset.testid = 'patch-review';
    const source = document.createElement('input');
    const other = document.createElement('input');
    panel.append(source, other);
    document.body.appendChild(panel);
    try {
      await act(async () => {
        emitFileSuggestion(suggestion({ requiresConfirmation: true }));
      });
      source.focus();
      act(() => {
        latest.rejectPendingSuggestion();
      });
      if (change === 'file')
        act(() => root.render(<Harness filePath={`${PROJECT}/正文/第02章.md`} />));
      if (change === 'suggestion')
        await act(async () => {
          emitFileSuggestion(suggestion({ id: 'patch-new', requiresConfirmation: true }));
        });
      if (change === 'selection') other.focus();
      await act(async () => {
        for (const callback of frames.splice(0)) callback(0);
      });
      assert.equal(calls.includes('focus'), change === 'none');
      assert.equal(writes.length, 0, '拒绝草稿不得写入文件');
    } finally {
      panel.remove();
      frame.mockRestore();
    }
  });
}

for (const mode of ['whole', 'partial-hunk', 'last-hunk']) {
  for (const replace of [true, false]) {
    test(`接受旧提议完成只收尾原提议：${mode}/替换=${replace}`, async () => {
      const before = '甲\n乙\n丙\n丁\n戊\n己\n庚';
      const after =
        mode === 'partial-hunk' ? '甲改\n乙\n丙\n丁\n戊\n己\n庚改' : '甲改\n乙\n丙\n丁\n戊\n己\n庚';
      editorContent = before;
      await act(async () => {
        emitFileSuggestion(suggestion({ before, after, requiresConfirmation: true }));
      });
      const hunks = buildPatchHunks(before, after);
      assert.equal(hunks.length, mode === 'partial-hunk' ? 2 : 1);
      const expectedWrite = mode === 'whole' ? after : applyPatchHunkToCurrent(before, hunks[0]);
      let finish!: () => void;
      manuscriptWriteGate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let saving!: Promise<void>;
      await act(async () => {
        saving =
          mode === 'whole' ? latest.handleAcceptSuggestion() : latest.handleAcceptHunk(hunks[0]);
      });
      if (replace)
        await act(async () => {
          emitFileSuggestion(
            suggestion({ before, after: '后来收到的新提议', requiresConfirmation: true }),
          );
        });
      await act(async () => {
        finish();
        await saving;
      });
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      if (replace) {
        assert.equal(latest.pendingSuggestion?.after, '后来收到的新提议');
        assert.equal(latest.pendingSuggestion?.before, before);
        assert.equal(calls.includes('focus'), false);
      } else if (mode === 'partial-hunk') {
        assert.equal(latest.pendingSuggestion?.before, expectedWrite);
        assert.equal(latest.pendingSuggestion?.after, after);
      } else assert.equal(latest.pendingSuggestion === null, true);
      assert.deepEqual(writes, [{ path: FILE, content: expectedWrite }]);
      assert.equal(calls.includes('snapshot'), true);
      assert.equal(calls.includes('record'), true);
      assert.equal(planMarkArgs.length, mode === 'whole' ? 1 : 0);
    });
  }
}

for (const switchProject of [true, false]) {
  test(`接受写入结束后记录和章节标记属于原项目：切换=${switchProject}`, async () => {
    await act(async () => {
      emitFileSuggestion(suggestion({ requiresConfirmation: true }));
    });
    let finish!: () => void;
    manuscriptWriteGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let saving!: Promise<void>;
    await act(async () => {
      saving = latest.handleAcceptSuggestion();
    });
    assert.deepEqual(writeRoots, [PROJECT]);
    if (switchProject)
      act(() =>
        root.render(<Harness projectPath="D:/隔离项目B" filePath="D:/隔离项目B/正文/第01章.md" />),
      );
    await act(async () => {
      finish();
      await saving;
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].projectPath, PROJECT);
    assert.equal(records[0].filePath, FILE);
    assert.deepEqual(planMarkArgs, [{ project_root: PROJECT, file_path: FILE }]);
    assert.deepEqual(writes, [{ path: FILE, content: AFTER }]);
  });
}

test('快照等待期间切项目，接受链仍传递原项目文件和分支给分支推进', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: true }));
  });
  let finish!: () => void;
  snapshotGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let saving!: Promise<void>;
  await act(async () => {
    saving = latest.handleAcceptSuggestion();
  });
  assert.equal(writes.length, 0);
  act(() => root.render(<Harness projectPath="D:/隔离B" filePath="D:/隔离B/章.md" />));
  await act(async () => {
    finish();
    await saving;
  });
  assert.deepEqual(branchTargets, [{ projectPath: PROJECT, filePath: FILE, branchId: 'main' }]);
  assert.deepEqual(writeRoots, [PROJECT]);
  assert.equal(records[0].projectPath, PROJECT);
});

for (const created of [false, true]) {
  for (const change of ['file', 'project']) {
    test(`撤销必须回到原项目文件，不能只比较相同正文：新建=${created}/${change}`, async () => {
      snapshotCreated = created;
      editorContent = created ? '' : BEFORE;
      await act(async () => {
        emitFileSuggestion(suggestion({ before: editorContent, requiresConfirmation: false }));
      });
      editorContent = AFTER;
      const undo = lastActionableToast();
      act(() =>
        root.render(
          <Harness
            projectPath={change === 'project' ? 'D:/另一本' : PROJECT}
            filePath={change === 'project' ? 'D:/另一本/章.md' : `${PROJECT}/另一章.md`}
          />,
        ),
      );
      await act(async () => {
        await undo.run();
      });
      assert.equal(writes.length, 1);
      assert.equal(deletes.length, 0);
      assert.equal(droppedTabs.length, 0);
      assert.match(toasts.at(-1)?.message ?? '', /原项目.*原文件/);
      assert.ok(toasts.at(-1)?.message.includes(FILE));
      const retry = lastActionableToast();
      assert.match(retry.label, /重试/);
      act(() => root.render(<Harness filePath={FILE} />));
      await act(async () => {
        await retry.run();
      });
      if (created) assert.deepEqual(deletes, [FILE]);
      else assert.deepEqual(writes[1], { path: FILE, content: BEFORE });
    });
  }
}

test('撤销失效后的版本历史入口同样验证原文件，且可返回重试', async () => {
  await act(async () => {
    emitFileSuggestion(suggestion({ requiresConfirmation: false }));
  });
  editorContent = `${AFTER}作者新增内容`;
  await act(async () => {
    await lastActionableToast().run();
  });
  const historyAction = lastActionableToast();
  assert.match(historyAction.label, /版本历史/);
  act(() => root.render(<Harness filePath={`${PROJECT}/另一章.md`} />));
  await act(async () => {
    await historyAction.run();
  });
  assert.equal(versionHistoryOpened, 0);
  const retry = lastActionableToast();
  act(() => root.render(<Harness filePath={FILE} />));
  await act(async () => {
    await retry.run();
  });
  assert.equal(versionHistoryOpened, 1);
  assert.equal(writes.length, 1);
});
