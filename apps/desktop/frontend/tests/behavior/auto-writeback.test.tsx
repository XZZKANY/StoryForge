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
const droppedTabs: string[] = [];
const calls: string[] = [];
let snapshotFails = false;
let snapshotCreated = false;
let versionHistoryOpened = 0;

vi.mock('../../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    writeFile: async (_root: string, path: string, content: string) => {
      calls.push('write');
      writes.push({ path, content });
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
    return { path: '/snapshot.md', timestamp: 1, created: snapshotCreated };
  },
}));

import { emitFileSuggestion } from '../../src/lib/assistant-events';
import { TOAST_EVENT, type ToastAction, type ToastDetail } from '../../src/lib/toast';
import { useSuggestionWriteback } from '../../src/components/editor/useSuggestionWriteback';

const PROJECT = 'D:/连载/末世吞噬';
const FILE = 'D:/连载/末世吞噬/正文/第01章.md';
const BEFORE = '旧的一章。';
const AFTER = '新的一章。';

/** 编辑器当前正文——测试要在写回之后改动它，模拟「作者又接着写了」。 */
let editorContent = BEFORE;
const toasts: ToastDetail[] = [];

function Harness({ filePath }: { filePath: string }) {
  const editorRef = useRef({
    getValue: () => editorContent,
    getModel: () => null,
  } as never);
  const originalContentRef = useRef(BEFORE);
  const cleanVersionIdRef = useRef<number | null>(null);
  const filePathRef = useRef<string | null>(filePath);
  const projectPathRef = useRef<string | null>(PROJECT);
  const modelCacheRef = useRef(new Map());
  filePathRef.current = filePath;

  useSuggestionWriteback({
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
    advanceBranchHead: async () => {
      calls.push('branch');
    },
    recordRevisionLoop: async () => {
      calls.push('record');
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
  writes.length = 0;
  deletes.length = 0;
  droppedTabs.length = 0;
  calls.length = 0;
  toasts.length = 0;
  snapshotFails = false;
  snapshotCreated = false;
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
