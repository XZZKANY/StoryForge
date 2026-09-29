import assert from 'node:assert/strict';
import { act, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { __getLastEditor } from 'monaco-editor';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { createWritebackQueue } from '../src/lib/writeback';
import { TauriFileSystem, type DiskBaseline } from '../src/lib/tauri-fs';
import type { WritebackRequest } from '../src/lib/writeback-receipt-types';
import { inspectFixtureReceipt, writeFixtureReceipt } from '../src/lib/writeback-receipt-fixture';
import { useSuggestionWriteback } from '../src/components/editor/useSuggestionWriteback';
import type { EditorModelCache } from '../src/components/editor/useMonacoEditor';
import { emitFileSuggestion } from '../src/lib/assistant-events';
import { buildPatchHunks } from '../src/lib/patch-hunks';
import type { AssistantFileSuggestion } from '../src/lib/assistant-suggestions';

const effects = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  snapshot: vi.fn(async () => ({ timestamp: 1, created: false })),
  write: vi.fn(async (_project: string, _path: string, _content: string) => {}),
  record: vi.fn(async (_record: unknown) => ({
    recordPath: '/record.md',
    updatedBlueprintPath: null,
  })),
  mark: vi.fn(async (_project: string | null, _path: string) => {}),
  dirty: vi.fn(),
  result: vi.fn(),
  toast: vi.fn(),
}));
const receiptFs = {
  pathExists: (path: string) => effects.disk.has(path),
  readFile: (path: string) => {
    const value = effects.disk.get(path);
    if (value === undefined) throw new Error('missing');
    return value;
  },
  writeFile: (path: string, content: string) => {
    effects.disk.set(path, content);
  },
};
vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: effects.snapshot }));
vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    writeFile: effects.write,
    inspectWritebackReceipt: (project: string, request: WritebackRequest) =>
      inspectFixtureReceipt(receiptFs, project, request),
    async writeFileWithReceipt(
      project: string,
      request: WritebackRequest,
      expected: DiskBaseline,
      checkpoint: number | null,
    ) {
      return writeFixtureReceipt(receiptFs, project, request, expected, checkpoint, () =>
        this.writeFileIfUnchanged(project, request.path, request.content, expected),
      );
    },
    writeFileIfUnchanged: async (
      project: string,
      path: string,
      content: string,
      expected: DiskBaseline,
    ) => {
      const current = effects.disk.get(path);
      if (expected.kind === 'missing' ? current !== undefined : current !== expected.content)
        throw new Error('磁盘内容已变化');
      await effects.write(project, path, content);
      effects.disk.set(path, content);
    },
  },
}));
vi.mock('../src/lib/serial-plan', () => ({ markChapterWrittenInPlan: effects.mark }));
vi.mock('../src/lib/toast', () => ({ emitToast: effects.toast }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILE = 'D:/project/a.md';
let root: Root;
let container: HTMLDivElement;
let handle: ReturnType<typeof useSuggestionWriteback>;
const noop = () => {};
const branch = () => ({
  id: 'main',
  label: 'main',
  headNodeId: null,
  color: '#123456',
  baseNodeId: null,
});
const advance = async () => {};
const normalize = (text: string) => text;

function Harness({ file = FILE, project = 'D:/project' }: { file?: string; project?: string }) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const originalContentRef = useRef('before');
  const cleanVersionIdRef = useRef<number | null>(null);
  const filePathRef = useRef<string | null>(file);
  const projectPathRef = useRef<string | null>(project);
  const modelCacheRef = useRef<EditorModelCache>(new Map());
  const queue = useRef(createWritebackQueue());
  useLayoutEffect(() => {
    filePathRef.current = file;
    projectPathRef.current = project;
    const editor = editorRef.current ?? monaco.editor.create(document.createElement('div'));
    editorRef.current = editor;
    let state = modelCacheRef.current.get(file);
    if (!state) {
      const content = effects.disk.get(file) ?? 'before';
      state = {
        model: monaco.editor.createModel(content),
        originalContent: content,
        diskBaseline: { kind: 'content', content },
        viewState: null,
      };
      modelCacheRef.current.set(file, state);
      effects.disk.set(file, content);
    }
    editor.setModel(state.model);
    const listener = editor.onDidChangeModelContent(() => {
      const active = modelCacheRef.current.get(filePathRef.current ?? '');
      effects.dirty(editor.getValue() !== active?.originalContent);
    });
    return () => listener.dispose();
  }, [file, project]);
  const state = useSuggestionWriteback({
    enqueueWriteback: queue.current,
    editorRef,
    originalContentRef,
    cleanVersionIdRef,
    filePathRef,
    projectPathRef,
    modelCacheRef,
    setLoadedContentPreview: noop,
    setIsDirty: effects.dirty,
    normalizeEol: normalize,
    getActiveBranchSnapshot: branch,
    advanceBranchHead: advance,
    recordRevisionLoop: effects.record,
    emitAuthorLoopResult: effects.result,
  });
  useLayoutEffect(
    () => state.resetSuggestionWriteback(),
    [file, project, state.resetSuggestionWriteback],
  );
  handle = state;
  return <output>{state.pendingSuggestion?.id ?? 'none'}</output>;
}
function patch(id: string, filePath = FILE): AssistantFileSuggestion {
  return {
    id,
    filePath,
    before: 'before',
    after: 'after',
    title: id,
    summary: id,
    note: '',
    createdAt: 1,
  };
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
async function show(suggestion: AssistantFileSuggestion) {
  await act(async () => {
    emitFileSuggestion(suggestion);
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  effects.disk.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('已开始的写回保持唯一锁，迟到成功不能清除新文件补丁', async () => {
  const pending = deferred<{ recordPath: string; updatedBlueprintPath: null }>();
  effects.record.mockReturnValueOnce(pending.promise);
  await show(patch('old'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = handle.handleAcceptSuggestion();
  });
  await act(async () => root.render(<Harness file="D:/project/b.md" />));
  await show(patch('new', 'D:/project/b.md'));
  await act(async () => handle.handleSaveSuggestionNote());
  assert.equal(effects.write.mock.calls.length, 1, '切文件不能释放旧写回事务锁');
  await act(async () => {
    pending.resolve({ recordPath: '/old.md', updatedBlueprintPath: null });
    await operation;
  });
  assert.equal(handle.pendingSuggestion?.id, 'new', '旧成功不能清掉新的补丁');
});

test('跨项目迟到的写回记录和章节标记始终属于原始项目', async () => {
  const pending = deferred<void>();
  effects.write.mockReturnValueOnce(pending.promise);
  await show(patch('old'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = handle.handleAcceptSuggestion();
  });
  await act(async () => root.render(<Harness file="D:/other/b.md" project="D:/other" />));
  await show(patch('new', 'D:/other/b.md'));
  await act(async () => {
    pending.resolve();
    await operation;
  });
  assert.equal(
    (effects.record.mock.calls[0][0] as { projectPath: string }).projectPath,
    'D:/project',
  );
  assert.deepEqual(effects.mark.mock.calls[0], ['D:/project', FILE]);
  assert.equal(handle.pendingSuggestion?.id, 'new');
  assert.equal(effects.toast.mock.calls.length, 0, '原项目成功不向新项目投递通知');
});

test('同 ID 新补丁也不能被旧旁注完成清除', async () => {
  const pending = deferred<void>();
  effects.write.mockReturnValueOnce(pending.promise);
  await show(patch('same'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = handle.handleSaveSuggestionNote();
  });
  const replacement = { ...patch('same'), after: 'replacement' };
  await show(replacement);
  await act(async () => {
    pending.resolve();
    await operation;
  });
  assert.equal(handle.pendingSuggestion, replacement);
});

test('快照失败保留当前补丁且允许重试，不允许任何稿件落盘', async () => {
  effects.snapshot.mockRejectedValueOnce(new Error('snapshot unavailable'));
  const suggestion = patch('failure');
  await show(suggestion);
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(handle.pendingSuggestion, suggestion);
  assert.equal(effects.write.mock.calls.length, 0);
  assert.equal(handle.actionState, null);
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 1);
});

test('面板可见时失败只进面板状态条，不再同文案补一条 toast（去双响）', async () => {
  effects.snapshot.mockRejectedValueOnce(new Error('snapshot unavailable'));
  const suggestion = patch('dedupe');
  await show(suggestion);
  const toastsBefore = effects.toast.mock.calls.length;
  await act(async () => handle.handleAcceptSuggestion());
  // 失败落在补丁面板状态条（actionError），同一时刻右下角不再弹同文案 error toast。
  assert.match(handle.actionError ?? '', /snapshot unavailable/);
  assert.equal(
    effects.toast.mock.calls
      .slice(toastsBefore)
      .filter((args: unknown[]) => (args[1] as { tone?: string } | undefined)?.tone === 'error')
      .length,
    0,
    '面板可见的失败不应再发 error toast',
  );
});

test('重试与整版、分块、旁注、拒绝共用一个 in-flight 锁', async () => {
  await show(patch('retry'));
  const pending = deferred<void>();
  let operation!: Promise<void>;
  await act(async () => {
    operation = handle.handleRetrySuggestion(() => pending.promise);
  });
  assert.equal(handle.actionState?.kind, 'retry');
  await act(async () => {
    await handle.handleAcceptSuggestion();
    await handle.handleAcceptHunk(buildPatchHunks('before', 'after')[0]);
    await handle.handleSaveSuggestionNote();
    handle.rejectPendingSuggestion();
  });
  assert.equal(effects.write.mock.calls.length, 0);
  assert.equal(handle.pendingSuggestion?.id, 'retry');
  await act(async () => {
    pending.reject(new Error('Agent unavailable'));
    await operation;
  });
  assert.match(handle.actionError ?? '', /Agent unavailable/);
  assert.equal(handle.actionState, null);
  await act(async () => handle.handleRetrySuggestion(async () => {}));
  assert.equal(handle.actionError, null);
});

test('同 ID 新补丁不接收旧接受失败，旧 finally 不清其他动作', async () => {
  const pending = deferred<void>();
  effects.write.mockReturnValueOnce(pending.promise);
  await show(patch('same'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = handle.handleAcceptSuggestion();
  });
  const next = { ...patch('same'), after: 'new-version' };
  await show(next);
  await act(async () => {
    pending.reject(new Error('old failure'));
    await operation;
  });
  assert.equal(handle.pendingSuggestion, next);
  assert.equal(handle.actionError, null);
  assert.equal(effects.result.mock.calls.length, 0);
});

test('卸载后旧旁注结果不再投递成功通知', async () => {
  const pending = deferred<void>();
  effects.write.mockReturnValueOnce(pending.promise);
  await show(patch('unmount'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = handle.handleSaveSuggestionNote();
  });
  act(() => root.render(null));
  await act(async () => {
    pending.resolve();
    await operation;
  });
  assert.equal(effects.toast.mock.calls.length, 0);
});

test('写回等待期间的继续输入不会被结算覆盖，且保留脏状态', async () => {
  const pending = deferred<{ recordPath: string; updatedBlueprintPath: null }>();
  effects.record.mockReturnValueOnce(pending.promise);
  await show(patch('typing'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = handle.handleAcceptSuggestion();
  });
  const editor = __getLastEditor();
  assert.ok(editor);
  editor.setValue('作者等待时的新输入');
  await act(async () => {
    pending.resolve({ recordPath: '/record', updatedBlueprintPath: null });
    await operation;
  });
  assert.equal(editor.getValue(), '作者等待时的新输入');
  assert.deepEqual(effects.dirty.mock.calls.at(-1), [true]);
});

test('分块接受至无剩余时给完结反馈，不再暗示「剩余修改仍可继续确认」', async () => {
  await show(patch('finish'));
  await act(async () => handle.handleAcceptHunk(buildPatchHunks('before', 'after')[0]));
  assert.equal(handle.pendingSuggestion, null, '内容已达 after 后补丁面板应收起');
  const texts = effects.toast.mock.calls.map((args: unknown[]) => String(args[0]));
  assert.ok(
    texts.some((text) => text.includes('已全部接受并写回')),
    '最后一块落盘后应给「已全部接受并写回」的完结反馈',
  );
  assert.equal(
    texts.some((text) => text.includes('剩余修改仍可继续确认')),
    false,
    '补丁已完结时不应再提示剩余修改可继续确认',
  );
});

test('分块接受的撤销 toast 点明撤的是哪一步，不暗示可逐步全撤', async () => {
  await show(patch('step'));
  await act(async () => handle.handleAcceptHunk(buildPatchHunks('before', 'after')[0]));
  const undoToast = effects.toast.mock.calls.find(
    (args: unknown[]) => (args[1] as { action?: unknown } | undefined)?.action,
  );
  assert.ok(undoToast, '分块接受后应照例弹出带撤销动作的通知');
  assert.match(
    String(undoToast[0]),
    /第 1 行附近/,
    '撤销 toast 必须标出对应的分块位置，多条并列时才知道各撤哪一步',
  );
  const action = (undoToast[1] as { action: { label: string } }).action;
  assert.equal(action.label, '撤销本次写回（回到该分块写回前）');
  assert.doesNotMatch(action.label, /逐步/);
});

test('连续接受两个分块时使用上一次落盘后的磁盘基线', async () => {
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`);
  const before = lines.join('\n');
  const changed = [...lines];
  changed[1] = 'first change';
  changed[18] = 'second change';
  const after = changed.join('\n');
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('two-hunks'), before, after });
  const hunks = buildPatchHunks(before, after);
  assert.equal(hunks.length, 2);
  await act(async () => handle.handleAcceptHunk(hunks[0]));
  const remaining = handle.pendingSuggestion;
  assert.ok(remaining);
  const nextHunks = buildPatchHunks(remaining.before, remaining.after);
  assert.equal(nextHunks.length, 1);
  await act(async () => handle.handleAcceptHunk(nextHunks[0]));
  assert.equal(effects.disk.get(FILE), after);
  assert.equal(effects.write.mock.calls.length, 2);
  assert.equal(handle.pendingSuggestion, null);
});

test('已落盘但审计失败清掉旧补丁，提供只补记录的可达动作', async () => {
  effects.record.mockRejectedValueOnce(new Error('audit unavailable'));
  await show(patch('audit-failure'));
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), 'after');
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(handle.actionError, null);
  const toast = effects.toast.mock.calls.find((args: unknown[]) =>
    String(args[0]).includes('闭环记录未完成'),
  );
  assert.ok(toast);
  assert.match(String(toast[0]), /正文已写入/);
  const action = (toast[1] as { action: { label: string; run: () => Promise<void> } }).action;
  assert.match(action.label, /不重写正文/);
  await act(async () => action.run());
  assert.equal(effects.record.mock.calls.length, 2);
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
  const ids = effects.record.mock.calls.map(
    ([record]) => (record as { operationId: string }).operationId,
  );
  assert.equal(ids[0], ids[1]);
});

test('卸载重开后重复确认只读取持久回执，不快照也不重复 apply', async () => {
  const proposal = patch('reopen');
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
  assert.equal(effects.disk.get(FILE), 'after');
  assert.equal(handle.pendingSuggestion, null);
});

test('native已写入但invoke回执丢失时只查询一次，不重复派发', async () => {
  const original = TauriFileSystem.writeFileWithReceipt;
  const spy = vi
    .spyOn(TauriFileSystem, 'writeFileWithReceipt')
    .mockImplementationOnce(async (...args) => {
      await original.apply(TauriFileSystem, args);
      throw new Error('IPC acknowledgement lost');
    });
  try {
    await show(patch('lost-ack'));
    await act(async () => handle.handleAcceptSuggestion());
    assert.equal(spy.mock.calls.length, 1);
    assert.equal(effects.write.mock.calls.length, 1);
    assert.equal(effects.disk.get(FILE), 'after');
    assert.equal(handle.pendingSuggestion, null);
    assert.equal(handle.actionError, null);
  } finally {
    spy.mockRestore();
  }
});

test('只剩intent且内容回到before时禁止自动重放与成功补记', async () => {
  const proposal = patch('unknown');
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  const journalPath = [...effects.disk.keys()].find((path) => path.includes('writeback-receipts'))!;
  const journal = JSON.parse(effects.disk.get(journalPath)!);
  journal.receipt.state = 'outcome_unknown';
  journal.receipt.receiptPersisted = false;
  effects.disk.set(journalPath, JSON.stringify(journal));
  effects.disk.set(FILE, 'before');
  await act(async () => __getLastEditor()!.setValue('before'));
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  assert.match(handle.actionError ?? '', /结果未知/);
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
  assert.equal(effects.record.mock.calls.length, 1);
  assert.equal(effects.disk.get(FILE), 'before');
});

test('重复确认已有回执不能把之后的未保存编辑覆盖回旧after', async () => {
  const proposal = patch('keep-unsaved');
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  await act(async () => __getLastEditor()!.setValue('after plus new unsaved paragraph'));
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(__getLastEditor()!.getValue(), 'after plus new unsaved paragraph');
  assert.equal(effects.disk.get(FILE), 'after');
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.dirty.mock.calls.at(-1)?.[0], true);
});

test('known applied but unreadable target reports unverifiable state without claiming file drift', async () => {
  const original = TauriFileSystem.writeFileWithReceipt;
  const spy = vi
    .spyOn(TauriFileSystem, 'writeFileWithReceipt')
    .mockImplementationOnce(async (...args) => ({
      ...(await original.apply(TauriFileSystem, args)),
      current: 'unreadable',
    }));
  try {
    await show(patch('unreadable'));
    await act(async () => handle.handleAcceptSuggestion());
    assert.equal(effects.disk.get(FILE), 'after');
    assert.equal(handle.pendingSuggestion, null);
    assert.equal(handle.actionError, null);
    const notice = effects.toast.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('无法读取核对'),
    );
    assert.ok(notice);
    assert.match(String(notice[0]), /已写入/);
    assert.doesNotMatch(String(notice[0]), /又发生变化/);
    assert.equal(effects.write.mock.calls.length, 1);
  } finally {
    spy.mockRestore();
  }
});
