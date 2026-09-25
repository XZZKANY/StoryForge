import assert from 'node:assert/strict';
import { act, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { __getLastEditor } from 'monaco-editor';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { useSuggestionWriteback } from '../src/components/editor/useSuggestionWriteback';
import type { EditorModelCache } from '../src/components/editor/useMonacoEditor';
import { emitFileSuggestion } from '../src/lib/assistant-events';
import { buildPatchHunks } from '../src/lib/patch-hunks';
import type { AssistantFileSuggestion } from '../src/lib/assistant-suggestions';

const effects = vi.hoisted(() => ({
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
vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: effects.snapshot }));
vi.mock('../src/lib/tauri-fs', () => ({ TauriFileSystem: { writeFile: effects.write } }));
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
  useLayoutEffect(() => {
    filePathRef.current = file;
    projectPathRef.current = project;
    const editor = editorRef.current ?? monaco.editor.create(document.createElement('div'));
    editorRef.current = editor;
    let state = modelCacheRef.current.get(file);
    if (!state) {
      state = {
        model: monaco.editor.createModel('before'),
        originalContent: 'before',
        viewState: null,
      };
      modelCacheRef.current.set(file, state);
    }
    editor.setModel(state.model);
  }, [file, project]);
  const state = useSuggestionWriteback({
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
