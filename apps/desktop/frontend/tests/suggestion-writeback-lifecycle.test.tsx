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

// ---------------------------------------------------------------------------
// T07：整份接受不得写冻结 after，必须把剩余 op 逐处映射到当前稿。
// harness 序列：补丁改第 1、3 行；作者独立改第 2 行为 AUTHOR；先分块接受第 1 行，
// 再整份接受 → 第二次写入不得把 AUTHOR 回退成补丁里的旧文本。
// ---------------------------------------------------------------------------
test('T07-①：局部接受后再整份接受，作者独立改动不被冻结 after 覆盖', async () => {
  const before = '甲。\n乙。\n丙。';
  const after = '甲改。\n乙。\n丙改。';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue('甲。\nAUTHOR\n丙。'));
  await show({ ...patch('t07-author'), before, after });
  const hunks = buildPatchHunks(before, after);
  assert.equal(hunks.length, 2, '补丁应有两处改动（第 1、3 行）');
  await act(async () => handle.handleAcceptHunk(hunks[0]));
  assert.ok(effects.disk.get(FILE)?.includes('AUTHOR'), '分块写回后 AUTHOR 仍应在磁盘');
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 2, '整份接受只应再写一次');
  assert.ok(
    String(effects.write.mock.calls[1][2]).includes('AUTHOR'),
    `第二次写入内容应含 AUTHOR，实际: ${JSON.stringify(effects.write.mock.calls[1][2])}`,
  );
  const disk = effects.disk.get(FILE) ?? '';
  assert.ok(disk.includes('AUTHOR'), `磁盘第 2 行应仍是 AUTHOR，实际: ${JSON.stringify(disk)}`);
  assert.ok(editor.getValue().includes('AUTHOR'), '编辑器第 2 行应仍是 AUTHOR');
  assert.equal(handle.actionError, null);
});

test('T07-②：作者改动落在剩余 op 覆盖行 → 映射失败、不再写入并报冲突', async () => {
  const before = '甲。\n乙。\n丙。';
  const after = '甲改。\n乙。\n丙改。';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('t07-conflict'), before, after });
  const hunks = buildPatchHunks(before, after);
  await act(async () => handle.handleAcceptHunk(hunks[0]));
  await act(async () => editor.setValue('甲改。\n乙。\n作者自改'));
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 1, '冲突时不得产生新的写入');
  assert.match(handle.actionError ?? '', /变化|冲突|定位/);
  assert.equal(effects.disk.get(FILE), '甲改。\n乙。\n丙。', '磁盘保持冲突前状态');
});

test('T07-③：无作者改动时整份接受结果与 after 逐字一致（快路径）', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('t07-fastpath'), before, after });
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), after);
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(handle.actionError, null);
});

test('T07-④：接受 A→AA 后作者改 B→B*，再整份接受 → B* 保留', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('t07-keep'), before, after });
  const hunks = buildPatchHunks(before, after);
  await act(async () => handle.handleAcceptHunk(hunks[0]));
  await act(async () => editor.setValue('AA\nB*\nC'));
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), 'AA\nB*\nCC');
  assert.ok(effects.disk.get(FILE)?.includes('B*'));
});

test('T07-⑤a：CRLF 与 emoji 下整份接受逐 op 映射，范围外行不动', async () => {
  const before = '甲😀。\r\n乙。\r\n丙。';
  const after = '甲😀改。\r\n乙。\r\n丙改。';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue('甲😀。\r\nAUTHOR\r\n丙。'));
  await show({ ...patch('t07-crlf'), before, after });
  const hunks = buildPatchHunks(before, after);
  assert.equal(hunks.length, 2);
  await act(async () => handle.handleAcceptHunk(hunks[0]));
  await act(async () => handle.handleAcceptSuggestion());
  const disk = effects.disk.get(FILE) ?? '';
  assert.ok(disk.includes('AUTHOR'), `CRLF 下 AUTHOR 应保留，实际: ${JSON.stringify(disk)}`);
  assert.ok(disk.includes('丙改。'), '剩余 op 应已映射');
});

test('T07-⑤b：剩余分块映射不回原始 op 时拒绝半选，不产生写入', async () => {
  const before = '甲。\n乙。\n丙。';
  const after = '甲改。\n乙。\n丙改。';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue('甲。\n作者改\n丙。'));
  await show({ ...patch('t07-ungroup'), before, after });
  const hunks = buildPatchHunks(before, after);
  await act(async () => handle.handleAcceptHunk(hunks[0]));
  const remaining = handle.pendingSuggestion;
  assert.ok(remaining);
  const remainingHunks = buildPatchHunks(remaining.before, remaining.after);
  const artifact = remainingHunks.find((hunk) => hunk.beforeText.includes('作者改'));
  assert.ok(
    artifact,
    `应能构造出无法映射的伪分块，实际: ${JSON.stringify(remainingHunks.map((h) => h.beforeText))}`,
  );
  await act(async () => handle.handleAcceptHunk(artifact));
  assert.equal(effects.write.mock.calls.length, 1, '拒绝半选不得产生写入');
  assert.match(handle.actionError ?? '', /对应不上|映射|歧义/);
});

test('T07-⑤c：整份逐 op 映射写回等待期间，作者继续输入不被覆盖', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('t07-typing'), before, after });
  const pending = deferred<{ recordPath: string; updatedBlueprintPath: null }>();
  effects.record.mockReturnValueOnce(pending.promise);
  await act(async () => editor.setValue('A\nB*\nC'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = handle.handleAcceptSuggestion();
  });
  await act(async () => editor.setValue('等待映射写回时的继续输入'));
  await act(async () => {
    pending.resolve({ recordPath: '/record', updatedBlueprintPath: null });
    await operation;
  });
  assert.equal(editor.getValue(), '等待映射写回时的继续输入');
  assert.ok(effects.disk.get(FILE)?.includes('B*'), '磁盘应落映射结果，含作者此前改动 B*');
});

async function runLastUndo() {
  const undoToast = effects.toast.mock.calls.find(
    (args: unknown[]) => (args[1] as { action?: unknown } | undefined)?.action,
  );
  assert.ok(undoToast, '写回后应弹撤销入口');
  await act(async () => {
    await (undoToast[1] as { action: { run: () => Promise<void> } }).action.run();
  });
}

test('T07-⑤d：撤销分块写回后再整份接受剩余，重新落到完整 after', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('t07-undo-rest'), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  await runLastUndo();
  assert.equal(effects.disk.get(FILE), before, '撤销后回到写前正文');
  assert.equal(handle.pendingSuggestion?.id, 't07-undo-rest', '补丁应仍在面板');
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), after, '整份接受剩余应落到完整 after');
});

test('T07-⑤e：撤销分块写回、作者再改范围外行后整份接受，改动保留', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('t07-undo-edit'), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  await runLastUndo();
  await act(async () => editor.setValue('A\nB*\nC'));
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), 'AA\nB*\nCC', '被撤销的 op 应重新应用，B* 保留');
});

test('T07-F3：删除类补丁重复确认幂等，不报错、不重复写、不丢数据', async () => {
  const before = '甲。\n乙。\n丙。';
  const after = '甲。\n丙。';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('t07-delete'), before, after });
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), after, '首次接受应删除目标行');
  assert.equal(effects.write.mock.calls.length, 1);
  // 重新领取同一补丁再次确认：删除 op 必须幂等，不得再删一次或报「原文已变化」。
  await show({ ...patch('t07-delete'), before, after });
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(handle.actionError, null, '重复确认不得报接受失败');
  assert.equal(effects.disk.get(FILE), after, '重复确认不得继续删除');
  assert.equal(effects.write.mock.calls.length, 1, '重复确认不应重复写盘');
});

test('T07-F1：重复目标行被作者改动后整份接受报冲突且零写入', async () => {
  const before = '重复句。\n重复句。\n尾巴。';
  const after = '重复句改。\n重复句。\n尾巴。';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('t07-dup'), before, after });
  // 作者在待确认期改了目标行（第一处重复），只剩另一处且上下文不再匹配。
  await act(async () => editor.setValue('重复句作者改。\n重复句。\n尾巴。'));
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 0, '冲突时零写入');
  assert.match(handle.actionError ?? '', /变化|冲突|定位/);
  assert.equal(effects.disk.get(FILE), 'before', '磁盘保持冲突前状态');
});

test('T07 高危回归：beforeText 为当前稿子串时整份接受不重复施加（无「铜铜」）', async () => {
  const before = '甲。\n灯亮了。\n乙。';
  const after = '甲。\n铜灯亮了。\n乙。';
  const current = '甲。\n铜灯亮了。\n乙。\n作者续写。';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(current));
  await show({ ...patch('t07-substring'), before, after });
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(handle.actionError, null);
  assert.ok(
    !(effects.disk.get(FILE) ?? '').includes('铜铜'),
    `整份接受不得把 beforeText 当子串再施加，实际: ${JSON.stringify(effects.disk.get(FILE))}`,
  );
  assert.equal(editor.getValue(), current, '作者稿应保持不变');
});

test('T07-F2b：重复块里作者已手动改出同一结果时，整份接受不改到第二处（hook）', async () => {
  const P = `${'P'.repeat(60)}\n`;
  const B = `${'B'.repeat(60)}\n`;
  const S = `${'S'.repeat(60)}\n`;
  const A = `${'A'.repeat(60)}\n`;
  const before = P + B + S + P + B + S;
  const after = P + A + S + P + B + S;
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(after));
  await show({ ...patch('t07-dup-block'), before, after });
  await act(async () => handle.handleAcceptSuggestion());
  const disk = effects.disk.get(FILE) ?? '';
  assert.equal(disk, after, '补丁只改第一处，第二处 B 不得被改成 A');
  assert.ok(disk.includes(B), '第二处 B 应保留');
  assert.equal(handle.actionError, null);
  assert.equal(editor.getValue(), after, '作者稿应保持不变');
});

// T10：分块接受与整份接受共用同一「前缀锚定 + 歧义即拒」定位器。
// 现状 bug（case32754 同类）：handleAcceptHunk 直接走 patch-hunks 的「取部分上下文最佳分」
// 定位，目标块上下文被作者改过、文中又有重复块时，会把补丁施加到另一处重复块（静默写错）。
test('T10：分块接受在目标上下文被改 + 重复块时拒绝，不把补丁写到另一处', async () => {
  const P = '甲'.repeat(48);
  const P2 = '戊'.repeat(10);
  const T = '目标句。';
  const T2 = '替换句。';
  const S = '乙'.repeat(48);
  const line = (s: string) => `${s}\n`;
  const before = [P, T, S, P, T, S].map(line).join('');
  const after = [P, T2, S, P, T, S].map(line).join('');
  const current = [P2, T, S, P, T, S].map(line).join('');
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(current));
  await show({ ...patch('t10-hunk-dupe'), before, after });
  const hunk = buildPatchHunks(before, after)[0];
  await act(async () => handle.handleAcceptHunk(hunk));
  assert.equal(effects.write.mock.calls.length, 0, '无法唯一确定目标时不得写盘');
  assert.match(handle.actionError ?? '', /定位|冲突|歧义|多次|对应不上/);
  assert.equal(
    (effects.disk.get(FILE) ?? '').includes(T2),
    false,
    '不得把补丁写到另一处重复块（磁盘不得出现替换文本）',
  );
});
