import assert from 'node:assert/strict';
import { act, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { __getLastEditor } from 'monaco-editor';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { createWritebackQueue } from '../src/lib/writeback';
import type { DiskBaseline } from '../src/lib/tauri-fs';
import type { WritebackRequest } from '../src/lib/writeback-receipt-types';
import { inspectFixtureReceipt, writeFixtureReceipt } from '../src/lib/writeback-receipt-fixture';
import { useSuggestionWriteback } from '../src/components/editor/useSuggestionWriteback';
import type { EditorModelCache } from '../src/components/editor/useMonacoEditor';
import { emitFileSuggestion } from '../src/lib/assistant-events';
import { buildPatchHunks } from '../src/lib/patch-hunks';
import type { AssistantFileSuggestion } from '../src/lib/assistant-suggestions';
import type { IssueCounts, IssueResolution, IssueScope } from '../src/lib/suggestion-ops';
import { readRevisionLoopIssues, recordRevisionLoop } from '../src/lib/author-loop';

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
    pathExists: (path: string) => effects.disk.has(path),
    readProjectFile: (_project: string, path: string) => receiptFs.readFile(path),
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
      // 恢复 journal 是 .storyforge 内部记录，不属于正文写回断言范围。
      if (path.includes('pending-suggestions')) {
        effects.disk.set(path, content);
        return;
      }
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
const TWO_BEFORE = '甲。\n乙。\n丙。';
const TWO_AFTER = '甲改。\n乙。\n丙改。';
const TWO_SCOPES: IssueScope[] = [
  { id: 'issue-A', lineStart: 1, lineEnd: 1 },
  { id: 'issue-B', lineStart: 3, lineEnd: 3 },
];

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

function patch(
  id: string,
  overrides: Partial<AssistantFileSuggestion> = {},
): AssistantFileSuggestion {
  return {
    id,
    filePath: FILE,
    before: 'before',
    after: 'after',
    title: id,
    summary: id,
    note: '',
    createdAt: 1,
    ...overrides,
  };
}

function twoIssuePatch(id: string): AssistantFileSuggestion {
  return patch(id, {
    before: TWO_BEFORE,
    after: TWO_AFTER,
    issueIds: ['issue-A', 'issue-B'],
    issueScopes: TWO_SCOPES,
  });
}

type CapturedRecord = {
  issueIds?: string[];
  issueResolutions?: IssueResolution[];
  issueCounts?: IssueCounts;
};

function lastRecord(): CapturedRecord {
  const call = effects.record.mock.calls.at(-1);
  assert.ok(call, '应已产生闭环记录');
  return call[0] as CapturedRecord;
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

test('D06-①：双 issue 补丁只接受覆盖 A 的分块 → 记录 A=resolved、B=open，计数 1/2', async () => {
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(TWO_BEFORE));
  await show(twoIssuePatch('d06-1'));
  const hunks = buildPatchHunks(TWO_BEFORE, TWO_AFTER);
  assert.equal(hunks.length, 2, '补丁应有两处改动');
  await act(async () => handle.handleAcceptHunk(hunks[0]));
  const record = lastRecord();
  assert.deepEqual(record.issueIds, ['issue-A', 'issue-B']);
  assert.deepEqual(record.issueResolutions, [
    { id: 'issue-A', status: 'resolved' },
    { id: 'issue-B', status: 'open' },
  ]);
  assert.deepEqual(record.issueCounts, { observed: 2, authorConfirmed: 1, resolved: 1 });
  const statusTexts = effects.toast.mock.calls.map((args: unknown[]) => String(args[0]));
  assert.ok(
    statusTexts.some((text) => text.includes('问题已解决 1/2（作者确认 1）')),
    `接受分块后应向作者分列问题读数，实际: ${JSON.stringify(statusTexts)}`,
  );
});

test('D06-②：整份接受 → 两个问题都 resolved（2/2）', async () => {
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(TWO_BEFORE));
  await show(twoIssuePatch('d06-2'));
  await act(async () => handle.handleAcceptSuggestion());
  const record = lastRecord();
  assert.deepEqual(record.issueResolutions, [
    { id: 'issue-A', status: 'resolved' },
    { id: 'issue-B', status: 'resolved' },
  ]);
  assert.deepEqual(record.issueCounts, { observed: 2, authorConfirmed: 2, resolved: 2 });
  const statusTexts = effects.toast.mock.calls.map((args: unknown[]) => String(args[0]));
  assert.ok(
    statusTexts.some((text) => text.includes('问题已解决 2/2（作者确认 2）')),
    `整份接受后应向作者分列问题读数，实际: ${JSON.stringify(statusTexts)}`,
  );
});

test('D06-③：接受覆盖 B 的分块后拒绝剩余 → A 始终 open 且拒绝不产生新记录', async () => {
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(TWO_BEFORE));
  await show(twoIssuePatch('d06-3'));
  const hunks = buildPatchHunks(TWO_BEFORE, TWO_AFTER);
  await act(async () => handle.handleAcceptHunk(hunks[1]));
  const record = lastRecord();
  assert.deepEqual(record.issueResolutions, [
    { id: 'issue-A', status: 'open' },
    { id: 'issue-B', status: 'resolved' },
  ]);
  const recordsBeforeReject = effects.record.mock.calls.length;
  await act(async () => {
    handle.rejectPendingSuggestion('');
  });
  assert.equal(effects.record.mock.calls.length, recordsBeforeReject, '拒绝不落写回记录');
});

test('D06-④：无行范围的旧补丁保留扁平 issueIds，状态全 open（不臆造）', async () => {
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue('before'));
  await show(patch('d06-4', { issueIds: ['legacy-1'] }));
  await act(async () => handle.handleAcceptSuggestion());
  const record = lastRecord();
  assert.deepEqual(record.issueIds, ['legacy-1']);
  assert.deepEqual(record.issueResolutions, [{ id: 'legacy-1', status: 'open' }]);
  assert.deepEqual(record.issueCounts, { observed: 1, authorConfirmed: 0, resolved: 0 });
  // D06-F1：拿不到行范围时向作者显式表达「未归属」，绝不报「解决 0/1」。
  assert.equal((record as { issueAttributed?: boolean }).issueAttributed, false);
  const statusTexts = effects.toast.mock.calls.map((args: unknown[]) => String(args[0]));
  assert.ok(
    statusTexts.some((text) => text.includes('未归属')),
    `无行范围时应提示未归属，实际: ${JSON.stringify(statusTexts)}`,
  );
  assert.equal(
    statusTexts.some((text) => text.includes('问题已解决 0/')),
    false,
    '不得把「无法归属」报成 0/N',
  );
  assert.deepEqual(readRevisionLoopIssues(record), [{ id: 'legacy-1', status: 'open' }]);
});

test('D06-⑥：issue 有行范围但本次无 op 覆盖 → 显示 0/N，不误标未归属', async () => {
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(TWO_BEFORE));
  await show(
    patch('d06-6', {
      before: TWO_BEFORE,
      after: TWO_AFTER,
      issueIds: ['issue-C'],
      issueScopes: [{ id: 'issue-C', lineStart: 2, lineEnd: 2 }],
    }),
  );
  await act(async () => handle.handleAcceptSuggestion());
  const record = lastRecord();
  // 有行范围数据即算已归属：即便本次没有 op 覆盖它，也要如实报 0/N。
  assert.equal((record as { issueAttributed?: boolean }).issueAttributed, true);
  assert.deepEqual(record.issueCounts, { observed: 1, authorConfirmed: 0, resolved: 0 });
  const statusTexts = effects.toast.mock.calls.map((args: unknown[]) => String(args[0]));
  assert.ok(
    statusTexts.some((text) => text.includes('问题已解决 0/1（作者确认 0）')),
    `有行范围应如实报 0/N，实际: ${JSON.stringify(statusTexts)}`,
  );
  assert.equal(
    statusTexts.some((text) => text.includes('未归属')),
    false,
    '有行范围时不得误标未归属',
  );
});

test('D06-⑤：无 issue 的补丁不产生空计数噪声', async () => {
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue('before'));
  await show(patch('d06-5'));
  await act(async () => handle.handleAcceptSuggestion());
  const record = lastRecord();
  assert.equal(record.issueResolutions ?? null, null);
  assert.equal(record.issueCounts ?? null, null);
});

test('D06-F3：分块接受后被作者改回原文的 op 不再把 issue 算成 resolved', async () => {
  const editor = __getLastEditor();
  assert.ok(editor);
  await act(async () => editor.setValue(TWO_BEFORE));
  await show(twoIssuePatch('d06-f3'));
  const hunks = buildPatchHunks(TWO_BEFORE, TWO_AFTER);
  // 接受覆盖 issue-A 的第 1 行分块，op0 进入已应用集合。
  await act(async () => handle.handleAcceptHunk(hunks[0]));
  // 作者把第 1 行改回原文、只在第 2 行做范围外改动 → op0 实际已不在稿内。
  await act(async () => editor.setValue('甲。\n作者手记\n丙。'));
  await act(async () => handle.handleAcceptSuggestion());
  const record = lastRecord();
  assert.deepEqual(
    record.issueResolutions,
    [
      { id: 'issue-A', status: 'open' },
      { id: 'issue-B', status: 'resolved' },
    ],
    '不在稿内的 op0 不得把 issue-A 算成 resolved',
  );
});

const BASE_RECORD = {
  projectPath: 'D:/Book',
  filePath: 'D:/Book/正文/第01章.md',
  before: '旧正文',
  after: '新正文',
  summary: '修订摘要',
  note: '备注',
  userIntent: '修人物动机',
  assistantSessionId: 1,
  patchId: 'p1',
};

test('D06：闭环记录分列问题状态与计数，扁平 issueIds 仍在', async () => {
  effects.write.mockClear();
  await recordRevisionLoop({
    ...BASE_RECORD,
    issueIds: ['issue-A', 'issue-B'],
    issueResolutions: [
      { id: 'issue-A', status: 'resolved' },
      { id: 'issue-B', status: 'open' },
    ],
    issueCounts: { observed: 2, authorConfirmed: 1, resolved: 1 },
  });
  const written = effects.write.mock.calls.at(-1);
  assert.ok(written);
  const content = String(written[2]);
  assert.match(content, /Issue IDs：issue-A, issue-B/);
  assert.match(content, /Issue Status：issue-A=resolved, issue-B=open/);
  assert.match(content, /Issue Counts：observed 2 \/ author-confirmed 1 \/ resolved 1/);
});

test('D06：旧记录只有扁平 issueIds 时不写状态/计数行，仍可读为 open', async () => {
  effects.write.mockClear();
  await recordRevisionLoop({ ...BASE_RECORD, issueIds: ['legacy-1'] });
  const written = effects.write.mock.calls.at(-1);
  assert.ok(written);
  const content = String(written[2]);
  assert.match(content, /Issue IDs：legacy-1/);
  assert.doesNotMatch(content, /Issue Status/);
  assert.doesNotMatch(content, /Issue Counts/);
  assert.deepEqual(readRevisionLoopIssues({ issueIds: ['legacy-1'] }), [
    { id: 'legacy-1', status: 'open' },
  ]);
});

test('D06-F1：无行范围时记录显式标注未归属，且不写 0/N 计数行', async () => {
  effects.write.mockClear();
  await recordRevisionLoop({
    ...BASE_RECORD,
    issueIds: ['legacy-1'],
    issueResolutions: [{ id: 'legacy-1', status: 'open' }],
    issueCounts: { observed: 1, authorConfirmed: 0, resolved: 0 },
    issueAttributed: false,
  });
  const written = effects.write.mock.calls.at(-1);
  assert.ok(written);
  const content = String(written[2]);
  assert.match(content, /Issue Status：legacy-1=open \(unattributed: 无行范围\)/);
  assert.doesNotMatch(content, /Issue Counts/);
  assert.doesNotMatch(content, /resolved 0/);
});
