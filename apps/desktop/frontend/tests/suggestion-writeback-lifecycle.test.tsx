import assert from 'node:assert/strict';
import { act, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { __getLastEditor } from 'monaco-editor';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { AgentRunEventRecord } from '../src/lib/api/agent-run-events';
import { createWritebackQueue } from '../src/lib/writeback';
import { TauriFileSystem, type DiskBaseline } from '../src/lib/tauri-fs';
import type { WritebackRequest } from '../src/lib/writeback-receipt-types';
import {
  createFixtureAudit,
  inspectFixtureReceipt,
  readFixtureAudit,
  writeFixtureReceipt,
} from '../src/lib/writeback-receipt-fixture';
import { useSuggestionWriteback } from '../src/components/editor/useSuggestionWriteback';
import type { EditorModelCache } from '../src/components/editor/useMonacoEditor';
import { emitFileSuggestion } from '../src/lib/assistant-events';
import { buildPatchHunks } from '../src/lib/patch-hunks';
import type { AssistantFileSuggestion } from '../src/lib/assistant-suggestions';
import {
  recordRevisionLoop as recordRealAudit,
  type RevisionLoopRecord,
} from '../src/lib/author-loop';
import {
  capturePendingSuggestion,
  loadPendingSuggestion,
  persistPendingSuggestion,
} from '../src/lib/suggestion-recovery';

const effects = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  session: vi.fn(async (_id: number) => ({ id: 7, project_path: 'D:/project' })),
  events: vi.fn(async (_runId: string): Promise<AgentRunEventRecord[]> => []),
  control: vi.fn(async (_request: unknown) => ({
    type: 'permission_approved',
    control_effect: 'applied',
    run_id: 'original-run',
    session_id: 'original-session',
    runtime_state: 'settled',
    run_status: 'completed',
  })),
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
  journalWrite: vi.fn(async (_path: string, _content: string) => {}),
  read: vi.fn(async (path: string) => {
    const value = effects.disk.get(path);
    if (value === undefined) throw new Error('missing audit');
    return value;
  }),
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
vi.mock('../src/lib/api/assistant', () => ({ getAssistantSession: effects.session }));
vi.mock('../src/lib/api/agent-runs', () => ({ getAgentRunEvents: effects.events }));
vi.mock('../src/lib/api/agent-socket', () => ({
  sendAgentControlMessage: effects.control,
  isAgentErrorMessage: (message: { type: string }) => message.type === 'error',
}));
vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: effects.snapshot }));
vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    writeFile: effects.write,
    pathExists: (path: string) => effects.disk.has(path),
    readProjectFile: (_project: string, path: string) =>
      path.includes('/pending-suggestions/') ? receiptFs.readFile(path) : effects.read(path),
    createWritebackAudit: (project: string, id: string, content: string) =>
      createFixtureAudit(receiptFs, project, id, content),
    readWritebackAudit: (project: string, request: WritebackRequest) =>
      readFixtureAudit(receiptFs, project, request),
    inspectWritebackReceipt: (project: string, request: WritebackRequest) =>
      inspectFixtureReceipt(receiptFs, project, request),
    repairWritebackCanonCache: vi.fn(async (project: string, request: WritebackRequest) => {
      const receipt = await inspectFixtureReceipt(receiptFs, project, request);
      if (!receipt) throw new Error('missing receipt');
      return { ...receipt, detail: undefined };
    }),
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
      if (path.includes('/pending-suggestions/')) await effects.journalWrite(path, content);
      else await effects.write(project, path, content);
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
  effects.record.mockImplementation(async (record: unknown) => ({
    ...(await recordRealAudit(record as RevisionLoopRecord)),
    recordPath: '/record.md',
    updatedBlueprintPath: null,
  }));
  effects.disk.clear();
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function recordNextRealAudit() {
  effects.record.mockImplementationOnce(async (record: unknown) => ({
    ...(await recordRealAudit(record as RevisionLoopRecord)),
    recordPath: '/record.md',
    updatedBlueprintPath: null,
  }));
}

async function partialBeforeCold(id = 'cold-partial') {
  const original = {
    ...patch(id),
    before: 'A\nB\nC',
    after: 'AA\nB\nCC',
    issueIds: ['a', 'c'],
    issueScopes: [
      { id: 'a', lineStart: 1, lineEnd: 1 },
      { id: 'c', lineStart: 3, lineEnd: 3 },
    ],
    contextFiles: ['knowledge/rules.md'],
  };
  await act(async () => __getLastEditor()!.setValue(original.before));
  await show(original);
  recordNextRealAudit();
  await act(async () =>
    handle.handleAcceptHunk(buildPatchHunks(original.before, original.after)[0]),
  );
  assert.equal(effects.disk.get(FILE), 'AA\nB\nC');
  return original;
}

async function remountForCold() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
  assert.equal(handle.pendingSuggestion, null, '新 editor 不持有旧 WeakMap 对象');
}

test('冷重挂恢复原剩余操作，只读核验后等待作者明确接受', async () => {
  const original = await partialBeforeCold();
  const descriptor = (await loadPendingSuggestion('D:/project', FILE))!;
  assert.equal(descriptor.proposal.before, original.before);
  assert.equal(descriptor.proposal.after, original.after);
  assert.equal(descriptor.requests.length, 1);
  assert.equal('appliedOpIds' in descriptor, false);
  assert.equal('operationView' in descriptor.proposal, false);
  const writes = effects.write.mock.calls.length;
  await remountForCold();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion?.requiresConfirmation, true);
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 1);
  assert.deepEqual(handle.pendingSuggestion?.issueScopes, original.issueScopes);
  assert.equal(effects.write.mock.calls.length, writes, '恢复不写稿、不造版本、不补审计');
  assert.equal(effects.snapshot.mock.calls.length, 1);
  assert.equal(effects.record.mock.calls.length, 1);
  recordNextRealAudit();
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), original.after);
  assert.equal(await loadPendingSuggestion('D:/project', FILE), null, '完成不复活旧提案');
});

test('冷恢复的接受历史不按字节倒推，作者撤回 A 后只接受原剩余 C', async () => {
  await partialBeforeCold('cold-author-revert');
  effects.disk.set(FILE, 'A\nAUTHOR\nC');
  await remountForCold();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 1);
  recordNextRealAudit();
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), 'A\nAUTHOR\nCC');
  const record = effects.record.mock.calls.at(-1)![0] as RevisionLoopRecord;
  assert.deepEqual(record.issueCounts, { observed: 2, authorConfirmed: 2, resolved: 1 });
});

test('冷恢复核验逆向回执链，明确重选继续引用原 op 与撤销回执', async () => {
  const original = await partialBeforeCold('cold-undo');
  recordNextRealAudit();
  await runLastUndo();
  assert.equal(effects.disk.get(FILE), original.before);
  const reverseId = (effects.record.mock.calls.at(-1)![0] as RevisionLoopRecord).operationId;
  await remountForCold();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 2);
  recordNextRealAudit();
  await act(async () =>
    handle.handleAcceptHunk(handle.pendingSuggestion!.operationView!.operations[0]),
  );
  const request = (await loadPendingSuggestion('D:/project', FILE))!.requests.at(-1)!.request;
  assert.ok(request.operationKey.endsWith(`:after-undo:${reverseId}`));
  assert.equal(
    request.source,
    JSON.stringify([original.id, original.before, original.after, null]),
  );
  assert.equal(effects.disk.get(FILE), 'AA\nB\nC');
});

test('完整审计不匹配时不授予剩余写回，修复后只读重试可恢复', async () => {
  await partialBeforeCold('cold-audit');
  const path = [...effects.disk.keys()].find((path) => path.includes('/author-loop/'))!;
  const audit = effects.disk.get(path)!;
  effects.disk.set(path, audit.replace('cold-audit', 'tampered-audit'));
  await remountForCold();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.write.mock.calls.length, 1);
  const retry = (effects.toast.mock.calls.at(-1)![1] as { action: { run: () => Promise<void> } })
    .action;
  assert.equal(retry.label, '重试核验（不写正文）');
  effects.disk.set(path, audit);
  await act(async () => retry.run());
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 1);
  assert.equal(effects.write.mock.calls.length, 1);
});

test('恢复期间的输入保留，新提案作废迟到核验且明确拒绝不再复活', async () => {
  await partialBeforeCold('cold-race');
  await remountForCold();
  const audit = [...effects.disk.entries()].find(([path]) => path.includes('/author-loop/'))![1];
  const pending = deferred<string>();
  effects.read.mockReturnValueOnce(pending.promise);
  let recovering!: Promise<void>;
  await act(async () => {
    recovering = handle.recoverPendingSuggestion(FILE);
  });
  await act(async () => __getLastEditor()!.setValue('AA\nAUTHOR\nC'));
  await act(async () => {
    pending.resolve(audit);
    await recovering;
  });
  assert.equal(handle.pendingSuggestion?.before, 'AA\nAUTHOR\nC');
  assert.equal(handle.pendingSuggestion?.after, 'AA\nAUTHOR\nCC');
  await act(async () => handle.resetSuggestionWriteback());
  const late = deferred<string>();
  effects.read.mockReturnValueOnce(late.promise);
  await act(async () => {
    recovering = handle.recoverPendingSuggestion(FILE);
  });
  const replacement = { ...patch('replacement'), before: 'AA\nAUTHOR\nC', after: 'new' };
  await show(replacement);
  await act(async () => {
    late.resolve(audit);
    await recovering;
  });
  assert.equal(handle.pendingSuggestion, replacement);
  assert.equal((await loadPendingSuggestion('D:/project', FILE))?.proposal.id, replacement.id);
  await act(async () => handle.rejectPendingSuggestion());
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion, null);
});

test('没有 Native 结果或 unknown 回执时不得按当前文本臆造消费，也不自动重放', async () => {
  await partialBeforeCold('cold-unknown');
  const path = [...effects.disk.keys()].find((path) => path.endsWith('.fixture.json'))!;
  const stored = JSON.parse(effects.disk.get(path)!);
  stored.receipt.state = 'outcome_unknown';
  effects.disk.set(path, JSON.stringify(stored));
  await remountForCold();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion, null);
  effects.disk.delete(path);
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
});

test('未接受自动档提案冷恢复也必须重新确认，跨项目不能领取缓存', async () => {
  await persistPendingSuggestion(
    'D:/project',
    capturePendingSuggestion('D:/project', { ...patch('cold-auto'), requiresConfirmation: false }),
  );
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion?.requiresConfirmation, true);
  assert.equal(effects.write.mock.calls.length, 0);
  await act(async () => root.render(<Harness file="D:/other/a.md" project="D:/other" />));
  await act(async () => handle.recoverPendingSuggestion('D:/other/a.md'));
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.write.mock.calls.length, 0);
});

test('冷核验期间导航或卸载不恢复旧提案，原缓存仍可留给作者返回处理', async () => {
  await partialBeforeCold('cold-navigation');
  await remountForCold();
  const audit = [...effects.disk.entries()].find(([path]) => path.includes('/author-loop/'))![1];
  const pending = deferred<string>();
  effects.read.mockReturnValueOnce(pending.promise);
  let recovering!: Promise<void>;
  await act(async () => {
    recovering = handle.recoverPendingSuggestion(FILE);
  });
  await act(async () => root.render(<Harness file="D:/project/b.md" />));
  await act(async () => {
    pending.resolve(audit);
    await recovering;
  });
  assert.equal(handle.pendingSuggestion, null);
  assert.equal((await loadPendingSuggestion('D:/project', FILE))?.proposal.id, 'cold-navigation');
  await act(async () => root.render(<Harness />));
  const unmounting = deferred<string>();
  effects.read.mockReturnValueOnce(unmounting.promise);
  await act(async () => {
    recovering = handle.recoverPendingSuggestion(FILE);
  });
  await act(async () => root.unmount());
  await act(async () => {
    unmounting.resolve(audit);
    await recovering;
  });
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.write.mock.calls.length, 1);
});

test('损坏请求源或 issue metadata 不能被冷恢复当作合法的原始提案', async () => {
  await partialBeforeCold('cold-corrupt');
  const key = [...effects.disk.keys()].find((key) => key.includes('/pending-suggestions/'))!;
  const saved = effects.disk.get(key)!;
  const corrupt = JSON.parse(saved);
  corrupt.requests[0].request.source = JSON.stringify(['forged-source']);
  effects.disk.set(key, JSON.stringify(corrupt));
  await remountForCold();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion, null);
  const invalidMetadata = JSON.parse(saved);
  invalidMetadata.proposal.issueScopes[0].lineStart = '1';
  effects.disk.set(key, JSON.stringify(invalidMetadata));
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
});

test('恢复缓存清理失败保留未完成的拒绝，但不撤回正文或永久占住动作锁', async () => {
  await effects.journalWrite.withImplementation(
    async (_path, content) => {
      // Target dismissal, not whichever registration/request happens to write next.
      if (content === 'null') throw new Error('journal cleanup unavailable');
    },
    async () => {
      await show(patch('storage-cleanup-reject'));
      await act(async () => handle.rejectPendingSuggestion());
      assert.equal(handle.pendingSuggestion?.id, 'storage-cleanup-reject');
      assert.equal(handle.actionState, null);
      assert.equal(effects.write.mock.calls.length, 0);
      await show(patch('storage-cleanup-accept'));
      await act(async () => handle.handleAcceptSuggestion());
      assert.equal(effects.disk.get(FILE), 'after');
      assert.equal(handle.pendingSuggestion, null);
      assert.equal(handle.actionState, null);
      assert.equal(effects.write.mock.calls.length, 1);
      assert.equal(
        effects.journalWrite.mock.calls.filter(([, content]) => content === 'null').length,
        2,
      );
      assert.equal(
        effects.toast.mock.calls.filter(([message]) => String(message).includes('恢复缓存未清理'))
          .length,
        2,
      );
    },
  );
});

test('清空或陈旧的 WebView storage 不丢失 Native 已保存的原决定', async () => {
  const original = await partialBeforeCold('native-journal');
  localStorage.setItem(
    'storyforge:pending-suggestion:v1:stale',
    JSON.stringify({
      version: 1,
      proposal: original,
      requests: [],
    }),
  );
  await remountForCold();
  localStorage.clear();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 1);
  assert.equal((await loadPendingSuggestion('D:/project', FILE))?.requests.length, 1);
  assert.equal(effects.write.mock.calls.length, 1);
});

test('原提案持久登记失败阻断正文，明确重新生成仍可继续', async () => {
  effects.journalWrite.mockRejectedValueOnce(new Error('journal unavailable'));
  await show(patch('native-journal-failed'));
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 0);
  assert.match(handle.actionError ?? '', /journal unavailable/);
  await show(patch('native-journal-fresh'));
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), 'after');
});

test('拒绝的 Native tombstone 持久化迟到时不清除同文件新提案', async () => {
  await show(patch('native-journal-old'));
  const pending = deferred<void>();
  effects.journalWrite.mockReturnValueOnce(pending.promise);
  let rejecting!: Promise<void>;
  await act(async () => {
    rejecting = handle.rejectPendingSuggestion();
  });
  const next = patch('native-journal-replacement');
  await show(next);
  await act(async () => {
    pending.resolve();
    await rejecting;
  });
  assert.equal(handle.pendingSuggestion, next);
  assert.equal((await loadPendingSuggestion('D:/project', FILE))?.proposal.id, next.id);
  assert.equal(effects.write.mock.calls.length, 0);
});

test('已开始的写回保持唯一锁，迟到成功不能清除新文件补丁', async () => {
  const pending = deferred<{ recordPath: string; updatedBlueprintPath: null }>();
  const enteredAudit = deferred<void>();
  effects.record.mockImplementationOnce(async () => {
    enteredAudit.resolve();
    return pending.promise;
  });
  await show(patch('old'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = handle.handleAcceptSuggestion();
    await enteredAudit.promise;
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
  await act(async () => {
    await vi.waitFor(() => assert.equal(effects.write.mock.calls.length, 1));
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

for (const kind of ['whole', 'last-hunk', 'partial'] as const) {
  test(`审计失败 ${kind} 冷开保留原请求，明确补记不再写正文`, async () => {
    const before = 'A\nB\nC';
    const after = 'AA\nB\nCC';
    await act(async () => __getLastEditor()!.setValue(before));
    await show({ ...patch(`cold-missing-${kind}`), before, after });
    if (kind === 'last-hunk') {
      recordNextRealAudit();
      await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
    }
    effects.record.mockRejectedValueOnce(new Error('audit unavailable'));
    await act(async () => {
      if (kind === 'whole') await handle.handleAcceptSuggestion();
      else {
        const suggestion = handle.pendingSuggestion!;
        await handle.handleAcceptHunk(buildPatchHunks(suggestion.before, suggestion.after)[0]);
      }
    });
    const journal = await loadPendingSuggestion('D:/project', FILE);
    assert.ok(journal, '已写正文但审计未完成，不可提前 tombstone');
    const body = effects.disk.get(FILE);
    const writes = effects.write.mock.calls.length;
    const snapshots = effects.snapshot.mock.calls.length;
    const records = effects.record.mock.calls.length;
    const marks = effects.mark.mock.calls.length;
    const receipts = [...effects.disk.entries()].filter(([path]) =>
      path.includes('writeback-receipts'),
    );
    await remountForCold();
    await act(async () => handle.recoverPendingSuggestion(FILE));
    assert.equal(handle.pendingSuggestion, null, '缺审计不能授予剩余写回');
    assert.equal(effects.record.mock.calls.length, records, '冷开只读');
    const action = (
      effects.toast.mock.calls.at(-1)![1] as {
        action: { label: string; run: () => Promise<void> };
      }
    ).action;
    assert.equal(action.label, '补记记录（不重写正文）');
    recordNextRealAudit();
    await act(async () => action.run());
    assert.equal(effects.disk.get(FILE), body);
    assert.equal(effects.write.mock.calls.length, writes);
    assert.equal(effects.snapshot.mock.calls.length, snapshots);
    assert.equal(effects.mark.mock.calls.length, marks);
    assert.deepEqual(
      [...effects.disk.entries()].filter(([path]) => path.includes('writeback-receipts')),
      receipts,
    );
    if (kind === 'partial')
      assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 1);
    else assert.equal(await loadPendingSuggestion('D:/project', FILE), null);
  });
}

test('缺审计时拒绝、继续接受或新提案均不能抹掉旧补记入口', async () => {
  const original = { ...patch('retain-missing'), before: 'A\nB\nC', after: 'AA\nB\nCC' };
  await act(async () => __getLastEditor()!.setValue(original.before));
  await show(original);
  effects.record.mockRejectedValueOnce(new Error('audit unavailable'));
  await act(async () =>
    handle.handleAcceptHunk(buildPatchHunks(original.before, original.after)[0]),
  );
  const saved = await loadPendingSuggestion('D:/project', FILE);
  await act(async () => handle.rejectPendingSuggestion());
  assert.ok(handle.pendingSuggestion, '未完成持久拒绝不能假报成功或恢复时复活');
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 1, '补记前不可继续写剩余正文');
  await show({ ...patch('replacement'), before: 'AA\nB\nC', after: 'new' });
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 1);
  assert.deepEqual(await loadPendingSuggestion('D:/project', FILE), saved);
  await remountForCold();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  const action = (effects.toast.mock.calls.at(-1)![1] as { action: { run: () => Promise<void> } })
    .action;
  await act(async () => action.run());
  assert.equal(handle.pendingSuggestion?.id, original.id);
});

for (const invalidation of [
  'unknown',
  'corrupt-audit',
  'invalid-payload',
  'project',
  'replacement',
] as const) {
  test(`冷补记重新核验 ${invalidation}，不沿用过期授权`, async () => {
    effects.record.mockRejectedValueOnce(new Error('audit unavailable'));
    await show(patch(`repair-${invalidation}`));
    await act(async () => handle.handleAcceptSuggestion());
    await remountForCold();
    await act(async () => handle.recoverPendingSuggestion(FILE));
    const action = (effects.toast.mock.calls.at(-1)![1] as { action: { run: () => Promise<void> } })
      .action;
    const calls = effects.record.mock.calls.length;
    const descriptor = (await loadPendingSuggestion('D:/project', FILE))!;
    const receipt = await TauriFileSystem.inspectWritebackReceipt(
      'D:/project',
      descriptor.requests[0].request,
    );
    const auditPath = `D:/project/.storyforge/author-loop/${receipt!.operationId}.md`;
    if (invalidation === 'unknown') {
      const key = [...effects.disk.keys()].find((path) => path.includes('writeback-receipts'))!;
      const stored = JSON.parse(effects.disk.get(key)!);
      stored.receipt.state = 'outcome_unknown';
      effects.disk.set(key, JSON.stringify(stored));
    } else if (invalidation === 'corrupt-audit') effects.disk.set(auditPath, 'torn');
    else if (invalidation === 'invalid-payload') {
      const key = [...effects.disk.keys()].find((path) => path.includes('pending-suggestions'))!;
      const stored = JSON.parse(effects.disk.get(key)!);
      const payload = JSON.parse(stored.requests[0].semanticPayload);
      payload.issueIds = [42];
      stored.requests[0].semanticPayload = JSON.stringify(payload);
      effects.disk.set(key, JSON.stringify(stored));
    } else if (invalidation === 'project')
      await act(async () => root.render(<Harness project="D:/other" file="D:/other/a.md" />));
    else await show(patch('new-proposal'));
    await act(async () => action.run());
    assert.equal(effects.record.mock.calls.length, calls);
    assert.equal(effects.write.mock.calls.length, 1);
    assert.equal(effects.snapshot.mock.calls.length, 1);
    assert.equal(
      effects.disk.get(auditPath),
      invalidation === 'corrupt-audit' ? 'torn' : undefined,
    );
  });
}

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
  assert.equal(handle.actionError, null, '读取已应用回执应完成结算，而非把保护性拒绝当恢复成功');
  assert.equal(handle.pendingSuggestion, null);
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
test('剩余预览只包含原始未接受操作，不把范围外作者文字列成待还原', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor()!;
  await act(async () => editor.setValue('A\nB*\nC'));
  await show({ ...patch('remaining-preview-author'), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  assert.equal(handle.pendingSuggestion?.before, 'AA\nB*\nC');
  assert.equal(handle.pendingSuggestion?.after, 'AA\nB*\nCC');
  const visible = buildPatchHunks(
    handle.pendingSuggestion!.before,
    handle.pendingSuggestion!.after,
  );
  assert.equal(visible.length, 1);
  assert.equal(visible[0].beforeText, 'C');
  assert.equal(visible[0].afterText, 'CC');
});

test('原操作均已分块接受后关闭补丁，不因独立作者修改留下幽灵残余', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor()!;
  await act(async () => editor.setValue(before));
  await show({ ...patch('remaining-finished-author'), before, after });
  const original = buildPatchHunks(before, after);
  await act(async () => handle.handleAcceptHunk(original[0]));
  await act(async () => editor.setValue('AA\nB*\nC'));
  await act(async () => handle.handleAcceptHunk(original[1]));
  assert.equal(effects.disk.get(FILE), 'AA\nB*\nCC');
  assert.equal(editor.getValue(), 'AA\nB*\nCC');
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.write.mock.calls.length, 2);
  assert.equal(handle.actionError, null);
});

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

test('连续分块接受拒绝把作者等长手改纳入原始操作，不再写盘', async () => {
  const before = '旧一。\n中间。\n旧二。';
  const after = '新一。\n中间。\n新二。';
  const editor = __getLastEditor()!;
  await act(async () => editor.setValue('旧一。\n中间。\n手改。'));
  await show({ ...patch('same-offset-author-edit'), before, after });
  const original = buildPatchHunks(before, after);
  await act(async () => handle.handleAcceptHunk(original[0]));
  const remaining = handle.pendingSuggestion!;
  assert.ok(remaining.operationView?.conflicts[original[1].id]);
  const hunk = buildPatchHunks(remaining.before, after)[0];
  assert.equal(hunk.id, original[1].id);
  await act(async () => handle.handleAcceptHunk(hunk));
  assert.equal(effects.write.mock.calls.length, 1, '作者改动冲突不得再写入');
  assert.equal(effects.disk.get(FILE), '新一。\n中间。\n手改。');
  assert.equal(editor.getValue(), '新一。\n中间。\n手改。');
  assert.match(handle.actionError ?? '', /对应不上|定位|冲突/);
});

test('两处改动距离很近时连续分块接受仍使用原始 op，不误拒正常修改', async () => {
  const before = '旧一。\n中间。\n旧二。';
  const after = '新一。\n中间。\n新二。';
  await act(async () => __getLastEditor()!.setValue(before));
  await show({ ...patch('nearby-ops'), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  const remaining = handle.pendingSuggestion!;
  await act(async () =>
    handle.handleAcceptHunk(buildPatchHunks(remaining.before, remaining.after)[0]),
  );
  assert.equal(effects.disk.get(FILE), after);
  assert.equal(effects.write.mock.calls.length, 2);
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(handle.actionError, null);
});

for (const navigation of ['reset', 'tabs', 'remount'] as const) {
  test(`分块接受后 ${navigation} 重新领取，整份接受仍保留范围外作者修改`, async () => {
    const before = '旧一。\n中间。\n旧二。';
    const after = '新一。\n中间。\n新二。';
    await act(async () => __getLastEditor()!.setValue('旧一。\n手改。\n旧二。'));
    await show({ ...patch(`preserve-origin-${navigation}`), before, after });
    await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
    if (navigation === 'tabs') {
      await act(async () => root.render(<Harness file="D:/project/b.md" />));
      await act(async () => root.render(<Harness />));
    } else {
      await act(async () => handle.resetSuggestionWriteback());
      if (navigation === 'remount') {
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(<Harness />));
      }
    }
    await act(async () => handle.adoptPendingSuggestion(FILE));
    assert.ok(handle.pendingSuggestion);
    await act(async () => handle.handleAcceptSuggestion());
    assert.equal(effects.disk.get(FILE), '新一。\n手改。\n新二。');
    assert.equal(__getLastEditor()!.getValue(), '新一。\n手改。\n新二。');
    assert.equal(effects.write.mock.calls.length, 2);
    assert.equal(handle.actionError, null);
  });
}

test('重新领取剩余补丁后原始目标处的作者改写仍然是冲突', async () => {
  const before = '旧一。\n中间。\n旧二。';
  const after = '新一。\n中间。\n新二。';
  await act(async () => __getLastEditor()!.setValue('旧一。\n中间。\n手改。'));
  await show({ ...patch('reopen-conflict'), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  await act(async () => handle.resetSuggestionWriteback());
  await act(async () => handle.adoptPendingSuggestion(FILE));
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.disk.get(FILE), '新一。\n中间。\n手改。');
  assert.match(handle.actionError ?? '', /变化|冲突|定位/);
});

test('同 id 的新提案对象不得继承旧提案的已应用集合', async () => {
  const before = '旧一。\n中间。\n旧二。';
  const after = '新一。\n中间。\n新二。';
  const proposal = { ...patch('reused-id-independent-object'), before, after };
  const editor = __getLastEditor()!;
  await act(async () => editor.setValue(before));
  await show(proposal);
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  await act(async () => editor.setValue('旧一。\n手改。\n旧二。'));
  await show({ ...proposal });
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.disk.get(FILE), '新一。\n手改。\n新二。');
  assert.equal(effects.write.mock.calls.length, 2);
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
  const remainingHunks = buildPatchHunks(remaining.before, after);
  assert.ok(!remaining.after.includes('乙。'), '剩余预览不能把作者改列为待还原');
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
  const undoToast = effects.toast.mock.calls
    .filter((args: unknown[]) => (args[1] as { action?: unknown } | undefined)?.action)
    .at(-1);
  assert.ok(undoToast, '写回后应弹撤销入口');
  await act(async () => {
    await (undoToast[1] as { action: { run: () => Promise<void> } }).action.run();
  });
}

test('撤销已落盘但记录失败，补记成功后恢复原分块并允许明确重选', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('undo-audit-repair'), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  effects.record.mockRejectedValueOnce(new Error('undo audit unavailable'));
  await runLastUndo();
  assert.equal(effects.disk.get(FILE), before);
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 1);
  const warning = effects.toast.mock.calls.find((args: unknown[]) =>
    String(args[0]).includes('undo audit unavailable'),
  );
  assert.ok(warning);
  const retry = (warning[1] as { action: { run: () => Promise<void> } }).action.run;
  await act(async () => retry());
  assert.equal(effects.write.mock.calls.length, 2, '补记不再写正文');
  assert.equal(effects.snapshot.mock.calls.length, 2, '补记不再创建版本');
  const restored = handle.pendingSuggestion?.operationView?.operations;
  assert.ok(restored);
  assert.equal(restored.length, 2, '成功补记应恢复撤销前的原消费集合');
  assert.equal(handle.pendingSuggestion?.before, before);
  assert.equal(handle.pendingSuggestion?.after, after);
  await act(async () => handle.handleAcceptHunk(restored[0]));
  assert.equal(effects.disk.get(FILE), 'AA\nB\nC');
  assert.equal(effects.write.mock.calls.length, 3);
  const ids = effects.record.mock.calls.map(
    ([record]) => (record as RevisionLoopRecord).operationId,
  );
  assert.equal(ids[1], ids[2], '只补原逆向回执的记录');
  assert.equal(new Set(ids).size, 3, '重选是新的作者决策');
});

async function failedUndoAudit(id: string) {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch(id), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  effects.record.mockRejectedValueOnce(new Error('undo audit unavailable'));
  await runLastUndo();
  const warning = effects.toast.mock.calls.find((args: unknown[]) =>
    String(args[0]).includes('undo audit unavailable'),
  );
  assert.ok(warning);
  const retry = (warning[1] as { action: { run: () => Promise<void> } }).action.run;
  return { before, after, editor, retry };
}

test('撤销补记再失败保留入口，等待成功时独占锁且保留作者输入', async () => {
  const { before, editor, retry } = await failedUndoAudit('undo-audit-retry-again');
  effects.record.mockRejectedValueOnce(new Error('still unavailable'));
  await act(async () => {
    await assert.rejects(retry(), /still unavailable/);
  });
  assert.equal(handle.actionState, null);
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 1);
  const pending = deferred<{ recordPath: string; updatedBlueprintPath: null }>();
  effects.record.mockReturnValueOnce(pending.promise);
  let repair!: Promise<void>;
  await act(async () => {
    repair = retry();
  });
  assert.equal(handle.actionState?.kind, 'undo');
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.write.mock.calls.length, 2, '补记等待时不能施加剩余操作');
  await act(async () => editor.setValue('A\n作者补记时继续输入\nC'));
  await act(async () => {
    pending.resolve({ recordPath: '/repaired', updatedBlueprintPath: null });
    await repair;
  });
  assert.equal(effects.disk.get(FILE), before);
  assert.equal(effects.write.mock.calls.length, 2);
  assert.equal(handle.pendingSuggestion?.before, 'A\n作者补记时继续输入\nC');
  assert.equal(handle.pendingSuggestion?.after, 'AA\n作者补记时继续输入\nCC');
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 2);
  const restored = handle.pendingSuggestion;
  await act(async () => retry());
  assert.equal(handle.pendingSuggestion, restored, '已结算的旧补记入口不得重置新消费状态');
  assert.equal(effects.write.mock.calls.length, 2);
});

for (const drift of ['disk', 'proposal', 'file'] as const) {
  test(`撤销补记迟到遇到 ${drift} 漂移只修原历史，不恢复旧消费授权`, async () => {
    const { before, retry } = await failedUndoAudit(`undo-audit-${drift}`);
    const pending = deferred<{ recordPath: string; updatedBlueprintPath: null }>();
    effects.record.mockReturnValueOnce(pending.promise);
    let repair!: Promise<void>;
    await act(async () => {
      repair = retry();
    });
    if (drift === 'disk') {
      effects.disk.set(FILE, '外部保存的不同正文');
    } else if (drift === 'proposal') {
      await show({ ...patch(`undo-audit-${drift}`), before, after: '新提案的正文' });
    } else {
      await act(async () => root.render(<Harness file="D:/project/b.md" />));
      await show(patch('new-file', 'D:/project/b.md'));
    }
    const currentPending = handle.pendingSuggestion;
    await act(async () => {
      pending.resolve({ recordPath: '/repaired-old', updatedBlueprintPath: null });
      await repair;
    });
    assert.equal(handle.pendingSuggestion, currentPending);
    assert.equal(effects.write.mock.calls.length, 2, '补记从不重写正文');
    assert.equal(handle.actionState, null);
    assert.equal(effects.disk.get(FILE), drift === 'disk' ? '外部保存的不同正文' : before);
    const ids = effects.record.mock.calls.map(
      ([record]) => (record as RevisionLoopRecord).operationId,
    );
    assert.equal(ids[1], ids[2], '只补原撤销的记录');
  });
}

test('原分块接受→撤销→两次重选必须各有新写入，不能复用 historical applied 回执', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('redo-original-op'), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  for (let iteration = 0; iteration < 2; iteration++) {
    await runLastUndo();
    assert.equal(effects.disk.get(FILE), before);
    const operations = handle.pendingSuggestion?.operationView?.operations;
    assert.ok(operations);
    assert.equal(operations.length, 2);
    await act(async () => handle.handleAcceptHunk(operations[0]));
    assert.equal(effects.disk.get(FILE), 'AA\nB\nC', '重选是新作者决定，不是旧写入回执恢复');
    assert.equal(editor.getValue(), 'AA\nB\nC');
    assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 1);
  }
  assert.equal(effects.write.mock.calls.length, 5, '接受/撤销/重选/撤销/重选各写一次');
  const ids = effects.record.mock.calls.map(
    ([record]) => (record as RevisionLoopRecord).operationId,
  );
  assert.equal(new Set(ids).size, 5, '五份回执对应五个明确动作');
});

test('旧撤销通知在重选后只查旧回执，不回退新写入或恢复旧消费集合', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('old-undo-not-redo'), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  const firstToast = effects.toast.mock.calls.find(
    (args: unknown[]) => (args[1] as { action?: unknown } | undefined)?.action,
  );
  assert.ok(firstToast);
  const oldUndo = (firstToast[1] as { action: { run: () => Promise<void> } }).action.run;
  await runLastUndo();
  const restored = handle.pendingSuggestion?.operationView?.operations;
  assert.ok(restored);
  await act(async () => handle.handleAcceptHunk(restored[0]));
  const currentPending = handle.pendingSuggestion;
  await act(async () => oldUndo());
  assert.equal(effects.disk.get(FILE), 'AA\nB\nC');
  assert.equal(handle.pendingSuggestion, currentPending);
  assert.equal(currentPending?.operationView?.operations.length, 1);
  assert.equal(effects.write.mock.calls.length, 3, '历史撤销回执不能重新执行');
});

test('撤销交付等待时独占原操作锁，并保留等待期间作者输入的剩余预览', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({ ...patch('undo-lock-and-typing'), before, after });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  const remaining = handle.pendingSuggestion?.operationView?.operations;
  assert.ok(remaining);
  const undoToast = effects.toast.mock.calls.find(
    (args: unknown[]) => (args[1] as { action?: unknown } | undefined)?.action,
  );
  assert.ok(undoToast);
  const pending = deferred<{ recordPath: string; updatedBlueprintPath: null }>();
  effects.record.mockReturnValueOnce(pending.promise);
  let undo!: Promise<void>;
  await act(async () => {
    undo = (undoToast[1] as { action: { run: () => Promise<void> } }).action.run();
  });
  assert.equal(handle.actionState?.kind, 'undo');
  await act(async () => handle.handleAcceptHunk(remaining[0]));
  await act(async () => editor.setValue('A\n作者等待时改了中段。\nC'));
  await act(async () => {
    pending.resolve({ recordPath: '/undo-record', updatedBlueprintPath: null });
    await undo;
  });
  assert.equal(effects.write.mock.calls.length, 2, '等待时不能并发接受剩余分块');
  assert.equal(effects.disk.get(FILE), before);
  assert.equal(editor.getValue(), 'A\n作者等待时改了中段。\nC');
  assert.equal(handle.pendingSuggestion?.before, editor.getValue());
  assert.equal(handle.pendingSuggestion?.after, 'AA\n作者等待时改了中段。\nCC');
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 2);
  assert.equal(handle.actionState, null);
});

for (const authorText of ['A', '作者自己重新写了甲段。']) {
  test(`D06：作者把已接受 A 改成 ${authorText} 后接受 C，不把历史确认当作当前解决`, async () => {
    const before = 'A\nB\nC';
    const after = 'AA\nB\nCC';
    const editor = __getLastEditor();
    assert.ok(editor);
    await act(async () => editor.setValue(before));
    await show({
      ...patch(`d06-${authorText}`),
      before,
      after,
      issueIds: ['issue-a', 'issue-c', 'unknown'],
      issueScopes: [
        { id: 'issue-a', lineStart: 1, lineEnd: 1 },
        { id: 'issue-c', lineStart: 3, lineEnd: 3 },
      ],
    });
    const operations = buildPatchHunks(before, after);
    await act(async () => handle.handleAcceptHunk(operations[0]));
    const first = effects.record.mock.calls.at(-1)?.[0] as RevisionLoopRecord;
    assert.deepEqual(first.issueCounts, { observed: 3, authorConfirmed: 1, resolved: 1 });
    await act(async () => editor.setValue(`${authorText}\nB\nC`));
    const remaining = handle.pendingSuggestion?.operationView?.operations;
    assert.ok(remaining);
    assert.equal(remaining.length, 1);
    await act(async () => handle.handleAcceptHunk(remaining[0]));
    assert.equal(effects.disk.get(FILE), `${authorText}\nB\nCC`);
    assert.equal(editor.getValue(), `${authorText}\nB\nCC`);
    const record = effects.record.mock.calls.at(-1)?.[0] as RevisionLoopRecord;
    assert.deepEqual(record.issueResolutions, [
      { id: 'issue-a', status: 'open' },
      { id: 'issue-c', status: 'resolved' },
      { id: 'unknown', status: 'open' },
    ]);
    assert.deepEqual(record.issueCounts, { observed: 3, authorConfirmed: 2, resolved: 1 });
    assert.ok(
      effects.toast.mock.calls.some((args) =>
        String(args[0]).includes('范围覆盖 1/3（作者确认 2；未作语义复核）'),
      ),
      '可见读数也须使用与闭环记录相同的分列计数',
    );
    assert.equal(handle.pendingSuggestion, null, '消费完成与问题是否解决是两件事');
    assert.equal(effects.write.mock.calls.length, 2, '不能偷偷恢复作者改回的 A');
  });
}

test('D06：保留 A 的实际结果时接受 C，两个独立问题均有覆盖；跨中段问题仅 touched', async () => {
  const before = 'A\nB\nC';
  const after = 'AA\nB\nCC';
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({
    ...patch('d06-retained'),
    before,
    after,
    issueIds: ['a', 'c', 'span'],
    issueScopes: [
      { id: 'a', lineStart: 1, lineEnd: 1 },
      { id: 'c', lineStart: 3, lineEnd: 3 },
      { id: 'span', lineStart: 1, lineEnd: 3 },
    ],
  });
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  const remaining = handle.pendingSuggestion?.operationView?.operations;
  assert.ok(remaining);
  await act(async () => handle.handleAcceptHunk(remaining[0]));
  const record = effects.record.mock.calls.at(-1)?.[0] as RevisionLoopRecord;
  assert.deepEqual(record.issueResolutions, [
    { id: 'a', status: 'resolved' },
    { id: 'c', status: 'resolved' },
    { id: 'span', status: 'touched' },
  ]);
  assert.deepEqual(record.issueCounts, { observed: 3, authorConfirmed: 3, resolved: 2 });
  assert.equal(effects.disk.get(FILE), after);
});

for (const middle of ['B', '作者自己改了中段。']) {
  test(`D06：撤回 A 的文字后整份接受剩余，${middle} 不重新授权已消费 A`, async () => {
    const before = 'A\nB\nC';
    const after = 'AA\nB\nCC';
    const editor = __getLastEditor();
    assert.ok(editor);
    await act(async () => editor.setValue(before));
    await show({
      ...patch(`d06-whole-${middle}`),
      before,
      after,
      issueIds: ['a', 'c'],
      issueScopes: [
        { id: 'a', lineStart: 1, lineEnd: 1 },
        { id: 'c', lineStart: 3, lineEnd: 3 },
      ],
    });
    await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
    await act(async () => editor.setValue(`A\n${middle}\nC`));
    await act(async () => handle.handleAcceptSuggestion());
    assert.equal(effects.disk.get(FILE), `A\n${middle}\nCC`, '整份接受仅施加原集合中未消费 C');
    const record = effects.record.mock.calls.at(-1)?.[0] as RevisionLoopRecord;
    assert.deepEqual(record.issueResolutions, [
      { id: 'a', status: 'open' },
      { id: 'c', status: 'resolved' },
    ]);
    assert.deepEqual(record.issueCounts, { observed: 2, authorConfirmed: 2, resolved: 1 });
  });
}

test('D06：整份接受时别处的同上下文替换文不能让原问题 resolved', async () => {
  const p = '甲'.repeat(48);
  const s = '乙'.repeat(48);
  const before = [p, '目标句。', s, p, '目标句。', s, '尾段。'].join('\n');
  const after = [p, '替换句。', s, p, '目标句。', s, '尾段改。'].join('\n');
  const current = [p, '作者自改。', s, p, '替换句。', s, '尾段。'].join('\n');
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({
    ...patch('d06-whole-repeated-context'),
    before,
    after,
    issueIds: ['first', 'tail'],
    issueScopes: [
      { id: 'first', lineStart: 2, lineEnd: 2 },
      { id: 'tail', lineStart: 7, lineEnd: 7 },
    ],
  });
  await act(async () => editor.setValue(current));
  await act(async () => handle.handleAcceptSuggestion());
  const record = effects.record.mock.calls.at(-1)?.[0] as RevisionLoopRecord;
  assert.deepEqual(record.issueResolutions, [
    { id: 'first', status: 'open' },
    { id: 'tail', status: 'resolved' },
  ]);
  assert.equal(effects.disk.get(FILE), current.replace('尾段。', '尾段改。'));
});

test('D06：分块幂等观察也不能把别处相同替换文作为原问题解决证据', async () => {
  const p = '甲'.repeat(48);
  const s = '乙'.repeat(48);
  const before = [p, '目标句。', s, p, '目标句。', s].join('\n');
  const after = [p, '替换句。', s, p, '目标句。', s].join('\n');
  const current = [p, '作者自改。', s, p, '替换句。', s].join('\n');
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(before));
  await show({
    ...patch('d06-hunk-repeated-context'),
    before,
    after,
    issueIds: ['first'],
    issueScopes: [{ id: 'first', lineStart: 2, lineEnd: 2 }],
  });
  await act(async () => editor.setValue(current));
  await act(async () => handle.handleAcceptHunk(buildPatchHunks(before, after)[0]));
  const record = effects.record.mock.calls.at(-1)?.[0] as RevisionLoopRecord;
  assert.deepEqual(record.issueResolutions, [{ id: 'first', status: 'open' }]);
  assert.deepEqual(record.issueCounts, { observed: 1, authorConfirmed: 1, resolved: 0 });
  assert.equal(effects.disk.get(FILE), current);
});

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
  assert.equal(handle.pendingSuggestion?.before, before, '撤销后预览基线也须回到写前正文');
  assert.equal(handle.pendingSuggestion?.after, after);
  assert.equal(handle.pendingSuggestion?.operationView?.operations.length, 2);
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

for (const removedBlock of [0, 1]) {
  for (const action of ['whole', 'hunk'] as const) {
    test(`重复块删除历史 ${removedBlock + 1}：${action} 不能从相同剩余文本猜测原目标`, async () => {
      const prefix = 'P'.repeat(48);
      const suffix = 'S'.repeat(48);
      const block = [prefix, '目标句。', suffix].join('\n') + '\n';
      const before = block + block + '尾声。';
      const after = [prefix, suffix, prefix, '目标句。', suffix, '尾声改。'].join('\n');
      const editor = __getLastEditor()!;
      await act(async () => editor.setValue(before));
      await show({ ...patch(`duplicate-history-${removedBlock}-${action}`), before, after });
      const start = removedBlock * block.length;
      const current = before.slice(0, start) + before.slice(start + block.length);
      assert.equal(current, block + '尾声。', '两种真实删除历史留下相同文字');
      await act(async () => editor.setValue(current));
      await act(async () => {
        if (action === 'whole') await handle.handleAcceptSuggestion();
        else await handle.handleAcceptHunk(buildPatchHunks(before, after)[0]);
      });
      assert.match(handle.actionError ?? '', /唯一|定位|歧义|冲突/);
      assert.equal(editor.getValue(), current);
      assert.equal(effects.write.mock.calls.length, 0);
      assert.equal(effects.snapshot.mock.calls.length, 0);
      assert.equal(effects.record.mock.calls.length, 0);
      await vi.waitFor(async () => {
        const descriptor = await loadPendingSuggestion('D:/project', FILE);
        assert.ok(descriptor);
        assert.equal(descriptor.requests.length, 0, '歧义操作不得获得 Native 准入');
      });
    });
  }
}

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

for (const remount of [false, true]) {
  for (const later of ['after plus later typing', 'entirely replaced by author']) {
    test(`completed reentry preserves later edits with fresh proposal (remount=${remount}, ${later})`, async () => {
      const proposal = patch('completed-fresh');
      await show(proposal);
      await act(async () => handle.handleAcceptSuggestion());
      const audits = [...effects.disk.entries()].filter(([key]) => key.includes('/author-loop/'));
      if (remount) {
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(<Harness />));
      }
      await act(async () => __getLastEditor()!.setValue(later));
      effects.toast.mockClear();
      await show({ ...proposal });
      await act(async () => handle.handleAcceptSuggestion());
      assert.equal(handle.actionError, null);
      assert.equal(handle.pendingSuggestion, null);
      assert.equal(__getLastEditor()!.getValue(), later);
      assert.equal(effects.disk.get(FILE), 'after');
      assert.equal(effects.write.mock.calls.length, 1);
      assert.equal(effects.snapshot.mock.calls.length, 1);
      assert.equal(effects.mark.mock.calls.length, 1);
      assert.equal(
        effects.record.mock.calls.length,
        2,
        'existing Native audit is verified, not rewritten',
      );
      assert.deepEqual(
        [...effects.disk.entries()].filter(([key]) => key.includes('/author-loop/')),
        audits,
      );
      assert.ok(
        !effects.toast.mock.calls.some(
          (args: unknown[]) => (args[1] as { action?: unknown })?.action,
        ),
      );
    });
  }
}

test('completed reentry recovers the original author-merged output and exact issue audit after remount', async () => {
  const proposal = {
    ...patch('completed-merged'),
    before: 'A\nB\nC',
    after: 'AA\nB\nC',
    issueIds: ['a'],
    issueScopes: [{ id: 'a', lineStart: 1, lineEnd: 1 }],
  };
  await act(async () => __getLastEditor()!.setValue('A\nB author text\nC'));
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  const committed = 'AA\nB author text\nC';
  assert.equal(effects.disk.get(FILE), committed);
  const first = effects.record.mock.calls[0][0] as RevisionLoopRecord;
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
  effects.disk.set(FILE, 'later saved version');
  await act(async () => __getLastEditor()!.setValue('later unsaved version'));
  await show({ ...proposal });
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(handle.actionError, null);
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(__getLastEditor()!.getValue(), 'later unsaved version');
  assert.equal(effects.disk.get(FILE), 'later saved version');
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
  const restored = effects.record.mock.calls[1][0] as RevisionLoopRecord;
  assert.equal(restored.after, committed, 'not the proposal.after or current buffer');
  assert.deepEqual(restored.issueCounts, first.issueCounts);
  assert.deepEqual(restored.issueResolutions, first.issueResolutions);
});

for (const invalid of ['missing-receipt', 'not-written', 'source', 'audit-content']) {
  test(`historical audit cannot authorize another write: ${invalid}`, async () => {
    const proposal = patch('completed-invalid');
    await show(proposal);
    await act(async () => handle.handleAcceptSuggestion());
    const receiptPath = [...effects.disk.keys()].find((key) => key.includes('writeback-receipts'))!;
    const auditPath = [...effects.disk.keys()].find((key) => key.includes('/author-loop/'))!;
    if (invalid === 'missing-receipt') effects.disk.delete(receiptPath);
    if (invalid === 'not-written') {
      const stored = JSON.parse(effects.disk.get(receiptPath)!);
      stored.receipt.state = 'not_written';
      effects.disk.set(receiptPath, JSON.stringify(stored));
    }
    if (invalid === 'audit-content') {
      const raw = effects.disk.get(auditPath)!;
      effects.disk.set(auditPath, raw.replace('after', 'forged'));
    }
    await act(async () => __getLastEditor()!.setValue('author replaces everything'));
    await show({ ...proposal, ...(invalid === 'source' ? { after: 'different proposal' } : {}) });
    await act(async () => handle.handleAcceptSuggestion());
    assert.ok(handle.actionError);
    assert.ok(handle.pendingSuggestion);
    assert.equal(__getLastEditor()!.getValue(), 'author replaces everything');
    assert.equal(effects.disk.get(FILE), 'after');
    assert.equal(effects.write.mock.calls.length, 1);
    assert.equal(effects.snapshot.mock.calls.length, 1);
    assert.equal(effects.record.mock.calls.length, 1);
  });
}

function runProposal(id = 'run-patch'): AssistantFileSuggestion {
  return { ...patch(id), runId: 'original-run', assistantSessionId: 7, requiresConfirmation: true };
}
function awaitingEvents(proposal: AssistantFileSuggestion): AgentRunEventRecord[] {
  return [
    {
      event_type: 'agent_execution_started',
      payload: { run_id: proposal.runId, session_id: 'original-session' },
    },
    {
      event_type: 'permission_required',
      payload: {
        assistant_session_id: 7,
        proposed_patch: {
          id: proposal.id,
          file_path: 'a.md',
          before: proposal.before,
          after: proposal.after,
        },
      },
    },
    { event_type: 'agent_execution_settled', payload: { runtime_state: 'settled' } },
  ];
}

test('whole acceptance settles original API session only after durable body and audit', async () => {
  const proposal = runProposal();
  effects.events.mockResolvedValue(awaitingEvents(proposal));
  effects.control.mockImplementationOnce(async (request) => {
    assert.deepEqual(request, {
      sessionId: 'original-session',
      runId: 'original-run',
      type: 'approve_permission',
      payload: { source: 'desktop.receipted-writeback', patch_id: proposal.id },
    });
    assert.equal(effects.disk.get(FILE), 'after');
    assert.ok([...effects.disk.keys()].some((key) => key.includes('/author-loop/')));
    assert.ok(
      await loadPendingSuggestion('D:/project', FILE),
      'retain recovery until acknowledgement',
    );
    return {
      type: 'permission_approved',
      control_effect: 'applied',
      run_id: 'original-run',
      session_id: 'original-session',
      runtime_state: 'settled',
      run_status: 'completed',
    };
  });
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(handle.actionError, null);
  assert.equal(effects.control.mock.calls.length, 1);
  assert.equal(await loadPendingSuggestion('D:/project', FILE), null);
  assert.equal(effects.result.mock.calls.at(-1)?.[0].runStatus, 'completed');
});

for (const auditOutcome of ['persisted', 'interrupted'] as const) {
  test(`unmount during audit retains original delivery for cold recovery: ${auditOutcome}`, async () => {
    const proposal = runProposal(`closing-audit-${auditOutcome}`);
    effects.events.mockResolvedValue(awaitingEvents(proposal));
    const entered = deferred<void>();
    const release = deferred<void>();
    effects.record.mockImplementationOnce(async (record: unknown) => {
      entered.resolve();
      await release.promise;
      if (auditOutcome === 'interrupted') throw new Error('audit interrupted by host closing');
      return {
        ...(await recordRealAudit(record as RevisionLoopRecord)),
        recordPath: '/record.md',
        updatedBlueprintPath: null,
      };
    });
    if (auditOutcome === 'persisted')
      effects.control.mockRejectedValueOnce(new Error('managed_host_closing'));
    await show(proposal);
    let accepting!: Promise<void>;
    await act(async () => {
      accepting = handle.handleAcceptSuggestion();
      await entered.promise;
    });
    assert.equal(handle.actionState?.kind, 'accept');
    assert.equal(effects.disk.get(FILE), proposal.after);
    assert.equal(effects.control.mock.calls.length, 0, 'no approval before audit completes');
    const original = (await loadPendingSuggestion('D:/project', FILE))!;
    assert.equal(original.requests.length, 1);
    const receipts = [...effects.disk.entries()].filter(([path]) =>
      path.includes('writeback-receipts'),
    );
    assert.ok(receipts.length);
    await act(async () => root.unmount());
    effects.disk.set(FILE, 'later author saved text');
    await act(async () => {
      release.resolve();
      await accepting;
    });
    assert.equal(effects.result.mock.calls.length, 0, 'old action cannot notify an unmounted page');
    assert.equal(effects.toast.mock.calls.length, 0, 'old action cannot publish an undo or repair');
    const retained = (await loadPendingSuggestion('D:/project', FILE))!;
    assert.equal(retained.owner, original.owner);
    assert.deepEqual(retained.requests, original.requests);
    assert.equal(effects.control.mock.calls.length, auditOutcome === 'persisted' ? 1 : 0);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await act(async () => handle.recoverPendingSuggestion(FILE));
    if (auditOutcome === 'interrupted') {
      assert.equal(
        effects.control.mock.calls.length,
        0,
        'cold discovery cannot approve missing audit',
      );
      assert.equal(effects.record.mock.calls.length, 1, 'cold discovery is read-only');
      assert.ok(await loadPendingSuggestion('D:/project', FILE));
      const action = effects.toast.mock.calls.at(-1)![1].action;
      assert.equal(action.label, '补记记录（不重写正文）');
      await act(async () => action.run());
    }
    assert.equal(await loadPendingSuggestion('D:/project', FILE), null);
    assert.equal(effects.control.mock.calls.length, auditOutcome === 'persisted' ? 2 : 1);
    assert.equal(effects.write.mock.calls.length, 1);
    assert.equal(effects.snapshot.mock.calls.length, 1);
    assert.equal(
      effects.mark.mock.calls.length,
      1,
      'cold recovery does not mark the chapter again',
    );
    assert.equal(effects.disk.get(FILE), 'later author saved text');
    assert.equal(__getLastEditor()!.getValue(), 'later author saved text');
    assert.deepEqual(
      [...effects.disk.entries()].filter(([path]) => path.includes('writeback-receipts')),
      receipts,
    );
    assert.equal(effects.result.mock.calls.at(-1)?.[0].runStatus, 'completed');
  });
}

test('lost control acknowledgement survives cold recovery without a second write or approval', async () => {
  const proposal = runProposal('lost-ack');
  const events = awaitingEvents(proposal);
  effects.events.mockResolvedValue(events);
  effects.control.mockImplementationOnce(async () => {
    events.push({
      event_type: 'agent_run_completed',
      payload: {
        control_type: 'approve_permission',
        run_id: 'original-run',
        session_id: 'original-session',
      },
    });
    throw new Error('ack lost');
  });
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  assert.ok(handle.actionError?.includes('ack lost'));
  assert.ok(await loadPendingSuggestion('D:/project', FILE));
  effects.disk.set(FILE, 'later author saved text');
  await remountForCold();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(await loadPendingSuggestion('D:/project', FILE), null);
  assert.equal(effects.control.mock.calls.length, 1);
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
  assert.equal(effects.disk.get(FILE), 'later author saved text');
});

test('failed control can be explicitly retried from original audit without replacing later edits', async () => {
  const proposal = runProposal('retry-control');
  effects.events.mockResolvedValue(awaitingEvents(proposal));
  effects.control.mockRejectedValueOnce(new Error('offline'));
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  assert.ok(handle.pendingSuggestion);
  effects.disk.set(FILE, 'later saved text');
  await act(async () => __getLastEditor()!.setValue('later unsaved text'));
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(handle.actionError, null);
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.control.mock.calls.length, 2);
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
  assert.equal(effects.disk.get(FILE), 'later saved text');
  assert.equal(__getLastEditor()!.getValue(), 'later unsaved text');
});

for (const invalid of [
  'patch',
  'session',
  'project',
  'new-execution',
  'stopped',
  'audit',
] as const) {
  test(`invalid original acceptance cannot settle the API run: ${invalid}`, async () => {
    const proposal = runProposal(`invalid-${invalid}`);
    const events = awaitingEvents(proposal);
    if (invalid === 'patch') events[1].payload!.proposed_patch = { id: 'other-patch' };
    if (invalid === 'project')
      effects.session.mockResolvedValueOnce({ id: 7, project_path: 'D:/other' });
    if (invalid === 'session') events[1].payload!.assistant_session_id = 99;
    if (invalid === 'new-execution') events.push(events[0]);
    if (invalid === 'stopped') events.push({ event_type: 'agent_run_interrupted', payload: {} });
    if (invalid === 'audit') effects.record.mockRejectedValueOnce(new Error('audit failed'));
    effects.events.mockResolvedValue(events);
    await show(proposal);
    await act(async () => handle.handleAcceptSuggestion());
    assert.equal(effects.disk.get(FILE), 'after');
    assert.equal(effects.control.mock.calls.length, 0);
    assert.ok(await loadPendingSuggestion('D:/project', FILE));
  });
}

test('last accepted hunk settles the original run; a partial acceptance does not', async () => {
  const proposal = { ...runProposal('hunk-run'), before: 'A\nB\nC', after: 'AA\nB\nCC' };
  effects.disk.set(FILE, proposal.before);
  await remountForCold();
  effects.events.mockResolvedValue(awaitingEvents(proposal));
  await show(proposal);
  const [first, last] = buildPatchHunks(proposal.before, proposal.after, 0);
  await act(async () => handle.handleAcceptHunk(first));
  assert.equal(effects.control.mock.calls.length, 0);
  await act(async () => handle.handleAcceptHunk(last));
  assert.equal(handle.actionError, null);
  assert.equal(effects.control.mock.calls.length, 1);
  assert.equal(await loadPendingSuggestion('D:/project', FILE), null);
});

test('accepting a usable patch preserves the original failed execution outcome', async () => {
  const proposal = runProposal('partial-execution');
  effects.events.mockResolvedValue(awaitingEvents(proposal));
  effects.control.mockResolvedValueOnce({
    type: 'permission_approved',
    control_effect: 'applied',
    run_id: 'original-run',
    session_id: 'original-session',
    runtime_state: 'settled',
    run_status: 'failed',
  });
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.result.mock.calls.at(-1)?.[0].runStatus, 'failed');
  assert.equal(effects.disk.get(FILE), 'after');
});

test('a replacement proposal cannot erase the only unsettled acceptance descriptor', async () => {
  const proposal = runProposal('pending-control');
  effects.events.mockResolvedValue(awaitingEvents(proposal));
  effects.control.mockRejectedValue(new Error('API unavailable'));
  try {
    await show(proposal);
    await act(async () => handle.handleAcceptSuggestion());
    const original = await loadPendingSuggestion('D:/project', FILE);
    assert.ok(original?.requests.length);
    await assert.rejects(
      persistPendingSuggestion(
        'D:/project',
        capturePendingSuggestion('D:/project', {
          ...patch('replacement'),
          before: 'after',
          after: 'new proposal',
        }),
      ),
      /API unavailable/,
    );
    assert.deepEqual(await loadPendingSuggestion('D:/project', FILE), original);
    assert.equal(effects.disk.get(FILE), 'after');
    assert.equal(effects.write.mock.calls.length, 1);
  } finally {
    effects.control.mockImplementation(async () => ({
      type: 'permission_approved',
      control_effect: 'applied',
      run_id: 'original-run',
      session_id: 'original-session',
      runtime_state: 'settled',
      run_status: 'completed',
    }));
  }
});

for (const invalid of ['ignored', 'foreign-run', 'in-flight'] as const) {
  test(`an unproven control acknowledgement retains recovery: ${invalid}`, async () => {
    const proposal = runProposal(`bad-ack-${invalid}`);
    effects.events.mockResolvedValue(awaitingEvents(proposal));
    effects.control.mockResolvedValueOnce({
      type: 'permission_approved',
      control_effect: invalid === 'ignored' ? 'ignored' : 'applied',
      run_id: invalid === 'foreign-run' ? 'another-run' : 'original-run',
      session_id: 'original-session',
      run_status: 'completed',
      runtime_state: invalid === 'in-flight' ? 'in_flight' : 'settled',
    });
    await show(proposal);
    await act(async () => handle.handleAcceptSuggestion());
    assert.ok(handle.actionError?.includes('结算尚未确认'));
    assert.ok(await loadPendingSuggestion('D:/project', FILE));
    assert.equal(effects.disk.get(FILE), 'after');
    assert.equal(effects.write.mock.calls.length, 1);
  });
}

test('automatic writeback reads its existing completion without approving or leaving the run waiting', async () => {
  const proposal = { ...runProposal('auto-completed'), requiresConfirmation: false };
  effects.events.mockResolvedValue([
    {
      event_type: 'agent_execution_started',
      payload: { run_id: proposal.runId, session_id: 'original-session' },
    },
    { event_type: 'agent_run_completed', payload: { assistant_session_id: 7 } },
  ]);
  await show(proposal);
  await vi.waitFor(() => assert.equal(handle.pendingSuggestion, null));
  assert.equal(effects.control.mock.calls.length, 0);
  assert.equal(effects.result.mock.calls.at(-1)?.[0].runStatus, 'completed');
  assert.equal(effects.disk.get(FILE), 'after');
});

for (const invalid of ['missing-completion', 'later-execution'] as const) {
  test(`automatic writeback cannot invent a run completion: ${invalid}`, async () => {
    const proposal = { ...runProposal(`auto-${invalid}`), requiresConfirmation: false };
    const started = {
      event_type: 'agent_execution_started',
      payload: { run_id: proposal.runId, session_id: 'original-session' },
    };
    effects.events.mockResolvedValue(
      invalid === 'missing-completion'
        ? [started]
        : [
            started,
            { event_type: 'agent_run_completed', payload: { assistant_session_id: 7 } },
            started,
          ],
    );
    await show(proposal);
    await vi.waitFor(() => assert.ok(handle.actionError?.includes('完成状态尚未确认')));
    assert.ok(await loadPendingSuggestion('D:/project', FILE));
    assert.equal(effects.control.mock.calls.length, 0);
    assert.equal(effects.disk.get(FILE), 'after');
  });
}

function deniedAck() {
  return {
    type: 'permission_denied',
    control_effect: 'applied',
    run_id: 'original-run',
    session_id: 'original-session',
    runtime_state: 'settled',
    run_status: 'failed',
  };
}
for (const action of ['reject', 'note'] as const) {
  test(`explicit ${action} settles the original pending run without writing the manuscript`, async () => {
    const proposal = runProposal(`deny-${action}`);
    effects.events.mockResolvedValue(awaitingEvents(proposal));
    effects.control.mockResolvedValueOnce(deniedAck());
    await show(proposal);
    await act(async () =>
      action === 'reject' ? handle.rejectPendingSuggestion() : handle.handleSaveSuggestionNote(),
    );
    assert.equal(handle.actionError, null);
    assert.equal(handle.pendingSuggestion, null);
    assert.equal(await loadPendingSuggestion('D:/project', FILE), null);
    assert.deepEqual(effects.control.mock.calls[0][0], {
      sessionId: 'original-session',
      runId: 'original-run',
      type: 'deny_permission',
      payload: { source: 'desktop.suggestion-decision', patch_id: proposal.id },
    });
    assert.equal(effects.disk.get(FILE), 'before');
    assert.equal(effects.snapshot.mock.calls.length, 0);
    assert.equal(effects.write.mock.calls.length, action === 'note' ? 1 : 0);
    if (action === 'note') assert.ok(effects.write.mock.calls[0][1].includes('/notes/'));
  });
}

test('offline rejection preserves the original proposal, releases its lock and can be retried', async () => {
  const proposal = runProposal('deny-offline');
  effects.events.mockResolvedValue(awaitingEvents(proposal));
  effects.control.mockRejectedValueOnce(new Error('offline'));
  await show(proposal);
  await act(async () => handle.rejectPendingSuggestion('new direction'));
  assert.equal(handle.pendingSuggestion?.id, proposal.id);
  assert.ok(handle.actionError?.includes('offline'));
  assert.equal(handle.actionState, null);
  assert.ok(await loadPendingSuggestion('D:/project', FILE));
  effects.control.mockResolvedValueOnce(deniedAck());
  await act(async () => handle.rejectPendingSuggestion());
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.disk.get(FILE), 'before');
  assert.equal(effects.write.mock.calls.length, 0);
});

test('cold recovery reads a lost denial acknowledgement and never resurrects the rejected patch', async () => {
  const proposal = runProposal('deny-ack-lost');
  const events = awaitingEvents(proposal);
  effects.events.mockResolvedValue(events);
  effects.control.mockImplementationOnce(async () => {
    events.push({
      event_type: 'agent_run_failed',
      payload: {
        control_type: 'deny_permission',
        run_id: 'original-run',
        session_id: 'original-session',
      },
    });
    throw new Error('ack lost');
  });
  await show(proposal);
  await act(async () => handle.rejectPendingSuggestion());
  assert.ok(await loadPendingSuggestion('D:/project', FILE));
  await remountForCold();
  await act(async () => handle.recoverPendingSuggestion(FILE));
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(await loadPendingSuggestion('D:/project', FILE), null);
  assert.equal(effects.control.mock.calls.length, 1);
  assert.equal(effects.write.mock.calls.length, 0);
});

test('rejecting remaining hunks preserves already written text and its evidence', async () => {
  const proposal = { ...runProposal('deny-remainder'), before: 'A\nB\nC', after: 'AA\nB\nCC' };
  effects.disk.set(FILE, proposal.before);
  await remountForCold();
  effects.events.mockResolvedValue(awaitingEvents(proposal));
  await show(proposal);
  await act(async () =>
    handle.handleAcceptHunk(buildPatchHunks(proposal.before, proposal.after, 0)[0]),
  );
  const body = effects.disk.get(FILE);
  effects.control.mockResolvedValueOnce(deniedAck());
  await act(async () => handle.rejectPendingSuggestion());
  assert.equal(handle.pendingSuggestion, null);
  assert.equal(effects.disk.get(FILE), body);
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
  assert.ok([...effects.disk.keys()].some((path) => path.includes('/author-loop/')));
});

test('repairing the original full acceptance audit also settles the run without another body write', async () => {
  const proposal = runProposal('repair-run');
  effects.events.mockResolvedValue(awaitingEvents(proposal));
  effects.record.mockRejectedValueOnce(new Error('audit unavailable'));
  await show(proposal);
  await act(async () => handle.handleAcceptSuggestion());
  assert.equal(effects.control.mock.calls.length, 0);
  assert.ok(await loadPendingSuggestion('D:/project', FILE));
  const retry = effects.toast.mock.calls.find(
    (args) => args[1]?.action?.label === '重试记录（不重写正文）',
  )?.[1].action.run;
  assert.ok(retry);
  effects.disk.set(FILE, 'later saved text');
  await act(async () => __getLastEditor()!.setValue('later unsaved text'));
  await act(async () => retry());
  assert.equal(effects.control.mock.calls.length, 1);
  assert.equal(await loadPendingSuggestion('D:/project', FILE), null);
  assert.equal(effects.write.mock.calls.length, 1);
  assert.equal(effects.snapshot.mock.calls.length, 1);
  assert.equal(effects.disk.get(FILE), 'later saved text');
  assert.equal(__getLastEditor()!.getValue(), 'later unsaved text');
  assert.equal(effects.result.mock.calls.at(-1)?.[0].runStatus, 'completed');
});

test.each([false, true])(
  '正文已写入但缓存失效失败时显示原生回执警告且不重放正文 (审计失败=%s)',
  async (auditFailed) => {
    const original = TauriFileSystem.writeFileWithReceipt;
    const spy = vi
      .spyOn(TauriFileSystem, 'writeFileWithReceipt')
      .mockImplementationOnce(async (...args) => ({
        ...(await original.apply(TauriFileSystem, args)),
        detail: 'canon 派生缓存未失效: 无法删除 presence.json',
      }));
    try {
      if (auditFailed) effects.record.mockRejectedValueOnce(new Error('audit unavailable'));
      await show(patch('cache-invalidation-warning'));
      await act(async () => handle.handleAcceptSuggestion());
      assert.equal(effects.disk.get(FILE), 'after');
      assert.equal(handle.pendingSuggestion, null);
      assert.equal(handle.actionError, null);
      assert.equal(effects.write.mock.calls.length, 1);
      const notice = effects.toast.mock.calls.find((args: unknown[]) =>
        String(args[0]).includes('canon 派生缓存未失效'),
      );
      assert.ok(notice, '已写入回执的 detail 不得被成功态吞掉');
      assert.match(String(notice[0]), /正文已写入/);
      assert.match(String(notice[0]), /不要重新应用/);
      let action = (notice[1] as { action: { label: string; run: () => Promise<void> } }).action;
      if (auditFailed) {
        assert.match(action.label, /重试记录/);
        await act(async () => action.run());
        const cacheNotice = effects.toast.mock.calls.at(-1)!;
        assert.match(String(cacheNotice[0]), /写回记录已补齐/);
        assert.match(String(cacheNotice[0]), /canon 派生缓存未失效/);
        assert.equal((cacheNotice[1] as { tone: string }).tone, 'info');
        action = (cacheNotice[1] as { action: typeof action }).action;
      }
      assert.match(action.label, /修复缓存/);
      await act(async () => action.run());
      assert.equal(effects.write.mock.calls.length, 1);
      assert.equal(effects.snapshot.mock.calls.length, 1);
      assert.equal(effects.disk.get(FILE), 'after');
    } finally {
      spy.mockRestore();
    }
  },
);
