/**
 * `/写` 批量写章调度器（E 刀），经真 ChatWindow：确认卡点开始 → 逐章发起（话、目标文件、这一批的授权）→
 * 等写进文件与事实记账落定才记、才问下一步 → 停下 / 写完的卡、「这批审完了」、「从第 k 章接着写」；
 * `/写` 续写、重开作品的提示、批量中不能发话 / 切会话、换作品时就地停下且晚到的结果不记。
 * 引擎这边（lib/api/write-batch）是一个按脚本走的假引擎；判断规则本身由引擎测试钉住。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { ApiWriteBatch, ApiWriteBatchPlan, ApiWriteBatchStep } from '../src/lib/api/contracts';
import type {
  RunAuthorAgentOptions,
  RunAuthorAgentOutcome,
} from '../src/components/chat-window/types';
import type { ChatWindowState } from '../src/components/chat-window/useChatWindowState';

vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));
const h = vi.hoisted(() => ({
  run: vi.fn(),
  stopRun: vi.fn(),
  selectSession: vi.fn(),
  newSession: vi.fn(),
  state: null as ChatWindowState | null,
}));
vi.mock('../src/components/chat-window/useRunAuthorAgent', () => ({
  useRunAuthorAgent: () => h.run,
}));
vi.mock('../src/components/chat-window/useChatSessionContext', () => ({
  useChatSessionContext: () => ({
    handleSelectSession: h.selectSession,
    handleNewSession: h.newSession,
    retryAssistantSessionLoad: () => {},
    retryContextCandidates: () => {},
    addExplicitContext: () => {},
    togglePinnedContext: () => {},
  }),
}));
vi.mock('../src/components/chat-window/useAgentRunRecovery', () => ({
  useAgentRunRecovery: () => ({}),
}));
vi.mock('../src/components/chat-window/useAgentStreamEvent', () => ({
  useAgentStreamEvent: () => () => {},
}));
vi.mock('../src/components/chat-window/useAgentRunControls', () => ({
  useAgentRunControls: () => ({
    retryLastFailedRun: () => {},
    agentRunControls: { onStopRun: h.stopRun },
  }),
}));
vi.mock('../src/components/chat-window/useChatWindowState', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/components/chat-window/useChatWindowState')>();
  return {
    ...actual,
    useChatWindowState: (props: Parameters<typeof actual.useChatWindowState>[0]) => {
      const state = actual.useChatWindowState(props);
      h.state = state;
      return state;
    },
  };
});
vi.mock('../src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api-client')>()),
  sendAgentControlMessage: vi.fn(async () => ({})),
}));

/** 假引擎：一份内存里的批量记录，按脚本给下一步。 */
const engine = vi.hoisted(() => ({
  steps: [] as unknown[],
  batch: null as unknown,
  planWriteBatch: vi.fn(),
  startWriteBatch: vi.fn(),
  nextWriteBatchStep: vi.fn(),
  recordWriteBatchChapter: vi.fn(),
  stopWriteBatch: vi.fn(),
  recoverInterruptedWriteBatch: vi.fn(),
  readWriteBatch: vi.fn(),
  markWriteBatchReviewed: vi.fn(),
  resumeWriteBatch: vi.fn(),
  previewWriteBatchResume: vi.fn(),
  formatWriteBatchTokens: vi.fn(async (tokens: number) => `${tokens / 10_000} 万`),
  currentWriteBatchModelKey: vi.fn(async () => 'model-a'),
}));
vi.mock('../src/lib/api/write-batch', () => engine);

import { ChatWindow } from '../src/components/ChatWindow';
import { sendAgentControlMessage } from '../src/lib/api-client';
import { emitNewSessionRequest } from '../src/lib/assistant-events';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';
import { permissionForRun } from '../src/lib/write-batch-grant';
import { WRITE_BATCH_TAB_EVENT, type WriteBatchTabRequest } from '../src/lib/write-batch-tabs';
import { reportChapterWriteback } from '../src/lib/write-batch-writeback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = 'D:/book';
const path = (ordinal: number) => `正文/第${String(ordinal).padStart(3, '0')}章.md`;

function plan(from: number, to: number, skip: number[] = []): ApiWriteBatchPlan {
  const chapters = [];
  for (let ordinal = from; ordinal <= to; ordinal += 1)
    chapters.push({
      ordinal,
      target_path: path(ordinal),
      title: `标题${ordinal}`,
      goal: `目标${ordinal}`,
      status: skip.includes(ordinal) ? ('skip_written' as const) : ('write' as const),
      written_path: skip.includes(ordinal) ? path(ordinal) : null,
    });
  const count = chapters.filter((chapter) => chapter.status === 'write').length;
  return {
    project_root: ROOT,
    from,
    to,
    permission_profile: 'ask',
    chapters,
    blockers: [],
    can_start: true,
    basis: 'history',
    estimate: {
      chapter_count: count,
      sample_count: 4,
      average_tokens: 62_000,
      min_tokens: 48_000,
      max_tokens: 91_000,
      estimated_calls: 0,
      unknown_calls: 0,
      estimated_tokens: 62_000 * count,
      cap_tokens: 186_000,
    },
    note: null,
  };
}

function batchOf(from: number, to: number): ApiWriteBatch {
  const chapters = [];
  for (let ordinal = from; ordinal <= to; ordinal += 1)
    chapters.push({
      ordinal,
      target_path: path(ordinal),
      state: 'pending' as const,
      run_id: null,
      written_sha256: null,
      chars: null,
      check: null,
      tokens: null,
      snapshot_version: null,
      facts_before: null,
      fact_disputes: null,
      facts_added: null,
    });
  return {
    version: 3,
    id: 'write-batch-1',
    from,
    to,
    created_at: '2026-10-30T00:00:00Z',
    model_key: 'model-a',
    note: null,
    status: 'running',
    reviewed: false,
    stop: null,
    legs: [
      {
        basis: 'history',
        cap_tokens: 186_000,
        estimated_tokens: 186_000,
        runs: [],
        started_at: '2026-10-30T00:00:00Z',
        used_tokens: 0,
      },
    ],
    chapters,
  };
}

const current = () => engine.batch as ApiWriteBatch;
const copy = () => structuredClone(current());
const firstPending = () => current().chapters.find((chapter) => chapter.state !== 'written');

function installEngine() {
  engine.steps = [];
  engine.batch = null;
  engine.planWriteBatch.mockImplementation(async (input: { from: number; to: number }) =>
    plan(input.from, input.to),
  );
  engine.startWriteBatch.mockImplementation(
    async (input: { from: number; to: number; note?: string | null }) => {
      engine.batch = batchOf(input.from, input.to);
      current().note = input.note ?? null;
      return { started: true, plan: plan(input.from, input.to), batch: copy() };
    },
  );
  engine.nextWriteBatchStep.mockImplementation(async () => {
    const step = (engine.steps.shift() as ApiWriteBatchStep | undefined) ?? {
      action: 'finished',
    };
    if (step.action === 'finished') current().status = 'finished';
    if (step.action === 'stop') {
      current().status = 'stopped';
      current().stop = { code: step.code, message: step.message, ordinal: step.ordinal };
    }
    // 真引擎在「写」这一步带回记录里的要求和计划里的章名。
    if (step.action === 'write')
      return { ...step, title: `标题${step.ordinal}`, note: current().note };
    return step;
  });
  engine.recordWriteBatchChapter.mockImplementation(
    async (input: {
      ordinal: number;
      runId: string;
      writtenPath: string | null;
      factDisputes: number;
      factsAdded: number | null;
    }) => {
      const chapter = current().chapters.find((item) => item.ordinal === input.ordinal)!;
      Object.assign(chapter, {
        state: input.writtenPath ? 'written' : 'stopped_here',
        run_id: input.runId,
        chars: input.writtenPath ? 3000 : null,
        check: { verdict: 'pass', issue_count: 2, summary: '通过，有 2 条建议' },
        tokens: 60_000,
        fact_disputes: input.factDisputes,
        facts_added: input.factsAdded,
      });
      const leg = current().legs.at(-1)!;
      leg.runs.push({ ordinal: input.ordinal, run_id: input.runId, tokens: 60_000 });
      leg.used_tokens += 60_000;
      return copy();
    },
  );
  engine.stopWriteBatch.mockImplementation(async (input: { code: string; message: string }) => {
    if (current().status === 'running') {
      current().status = 'stopped';
      current().stop = {
        code: input.code as never,
        message: input.message,
        ordinal: firstPending()?.ordinal ?? null,
      };
    }
    return copy();
  });
  engine.readWriteBatch.mockImplementation(async (root: string) => {
    // 别的作品没有批量记录；读记录时每章带上连载计划里的标题。
    const record = engine.batch && root === ROOT ? copy() : null;
    const batch = record && {
      ...record,
      chapters: record.chapters.map((chapter) => ({
        ...chapter,
        title: `标题${chapter.ordinal}`,
        goal: `目标${chapter.ordinal}`,
      })),
    };
    const resumeFrom = batch ? (firstPending()?.ordinal ?? null) : null;
    return {
      batch,
      mismatches: [],
      can_resume: batch?.status === 'stopped' && resumeFrom !== null,
      resume_from: resumeFrom,
    };
  });
  engine.recoverInterruptedWriteBatch.mockImplementation(async (root: string) => ({
    recovered: false,
    batch: engine.batch && root === ROOT ? copy() : null,
  }));
  engine.markWriteBatchReviewed.mockImplementation(async () => {
    current().reviewed = true;
    return copy();
  });
  // 只读的续写预览：同一份计划，记录不动。
  engine.previewWriteBatchResume.mockImplementation(async () => {
    const batch = current();
    const written = batch.chapters.filter((c) => c.state === 'written').map((c) => c.ordinal);
    return plan(batch.from, batch.to, written);
  });
  engine.resumeWriteBatch.mockImplementation(async () => {
    const batch = current();
    const written = batch.chapters.filter((c) => c.state === 'written').map((c) => c.ordinal);
    batch.status = 'running';
    batch.stop = null;
    batch.legs.push({
      basis: 'history',
      cap_tokens: 124_000,
      estimated_tokens: 124_000,
      runs: [],
      started_at: '2026-10-30T01:00:00Z',
      used_tokens: 0,
    });
    return { started: true, plan: plan(batch.from, batch.to, written), batch: copy() };
  });
}

type Dispatched = {
  goal: string;
  action: unknown;
  intent: unknown;
  options: RunAuthorAgentOptions;
  runId: string;
  resolve: (outcome: RunAuthorAgentOutcome) => void;
};
let runs: Dispatched[];
let root: Root;
let host: HTMLDivElement;
let toasts: string[];
let tabs: WriteBatchTabRequest[];
const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail.message);
const onTab = (event: Event) => tabs.push((event as CustomEvent<WriteBatchTabRequest>).detail);

// 会话菜单等浮层挂在 body 上，按整页找。
const q = <T extends Element = HTMLElement>(testid: string) =>
  document.querySelector<T & HTMLElement>(`[data-testid="${testid}"]`);
const text = (testid: string) => q(testid)?.textContent ?? null;
const ROW_PARTS = [
  'write-batch-row-open',
  'write-batch-row-name',
  'write-batch-row-chars',
  'write-batch-row-check',
  'write-batch-row-facts',
  'write-batch-row-tokens',
  'write-batch-row-goal',
  'write-batch-row-mismatch',
];
/** 清单的每一行，按列拼起来。 */
const rows = () =>
  [...document.querySelectorAll('[data-testid="write-batch-result-chapter"]')].map((row) =>
    ROW_PARTS.map((id) => row.querySelector(`[data-testid="${id}"]`)?.textContent ?? null)
      .filter((part) => part !== null)
      .join(' | '),
  );
const click = async (testid: string) =>
  act(async () => {
    q<HTMLButtonElement>(testid)!.click();
  });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
async function until(assertion: () => void) {
  await vi.waitFor(async () => {
    await settle();
    assertion();
  });
}

async function render(projectPath = ROOT) {
  await act(async () =>
    root.render(<ChatWindow projectPath={projectPath} currentFile={null} assistantSessionId={1} />),
  );
}

async function submitComposer(value: string) {
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('composer-submit');
}

/** 打 `/写 a-b …`，等确认卡排好计划，点「开始写」。 */
async function startBatch(command = '/写 4-6 节奏快一点') {
  await submitComposer(command);
  await until(() => expect(q('write-batch-start')).not.toBeNull());
  await click('write-batch-start');
  await until(() => expect(runs.length).toBeGreaterThan(0));
}

const autoOutcome = (run: Dispatched): RunAuthorAgentOutcome => ({
  kind: 'settled',
  runId: run.runId,
  proposal: {
    patchId: `patch-${run.runId}`,
    filePath: `${ROOT}/${run.options.targetFilePath}`,
    requiresConfirmation: false,
  },
});

/** 这一轮交了修订、编辑器写进文件、事实记账落定。 */
async function finishChapter(index: number) {
  const run = runs[index];
  await act(async () => run.resolve(autoOutcome(run)));
  reportChapterWriteback(run.runId, {
    written: true,
    filePath: `${ROOT}/${run.options.targetFilePath}`,
    snapshotVersion: `.storyforge/versions/${run.options.targetFilePath}/checkpoints/1.meta.json`,
    factsBefore: null,
    factDisputes: 0,
    factsAdded: 3,
    factError: null,
  });
  await settle();
}

const grantedProfile = (run: Dispatched) =>
  permissionForRun({
    stored: 'ask',
    projectPath: ROOT,
    intent: run.intent as string,
    targetFilePath: run.options.targetFilePath,
    grant: run.options.writeBatchGrant,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  installEngine();
  runs = [];
  toasts = [];
  tabs = [];
  h.stopRun.mockReset();
  h.selectSession.mockReset();
  h.newSession.mockReset();
  vi.mocked(sendAgentControlMessage).mockClear();
  h.run
    .mockReset()
    .mockImplementation(
      (
        goal: string,
        action: unknown,
        intent: unknown,
        _ids: unknown,
        options: RunAuthorAgentOptions,
      ) => {
        const runId = `run-${runs.length + 1}`;
        h.state!.agentRunIdRef.current = runId;
        return new Promise<RunAuthorAgentOutcome>((resolve) =>
          runs.push({ goal, action, intent, options, runId, resolve }),
        );
      },
    );
  window.addEventListener(TOAST_EVENT, onToast);
  window.addEventListener(WRITE_BATCH_TAB_EVENT, onTab);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(() => {
  window.removeEventListener(TOAST_EVENT, onToast);
  window.removeEventListener(WRITE_BATCH_TAB_EVENT, onTab);
  act(() => root.unmount());
  host.remove();
});

test('开始写：逐章按自动档发起，等写进文件与记账落定才记、才问下一步；写完出卡，可标审完', async () => {
  engine.steps = [
    { action: 'write', ordinal: 4, target_path: path(4), goal: '目标4' },
    { action: 'write', ordinal: 5, target_path: path(5), goal: '目标5' },
    { action: 'write', ordinal: 6, target_path: path(6), goal: '目标6' },
  ];
  await startBatch();
  expect(engine.startWriteBatch).toHaveBeenCalledWith({
    projectRoot: ROOT,
    from: 4,
    to: 6,
    permissionProfile: 'ask',
    modelKey: 'model-a',
    note: '节奏快一点',
  });
  expect(q('write-batch-card')).toBeNull();
  const [first] = runs;
  expect(first.goal).toBe('写第 4 章（批量第 1 / 3 章）\n作者要求：节奏快一点');
  expect([first.action, first.intent, first.options.targetFilePath]).toEqual([
    'agent',
    'chapter.write',
    path(4),
  ]);
  expect(grantedProfile(first)).toBe('auto');
  expect(
    [...host.querySelectorAll('[data-testid="user-message"]')].map((node) => node.textContent),
  ).toEqual(['写第 4 章（批量第 1 / 3 章）\n作者要求：节奏快一点']);
  await until(() =>
    expect(text('write-batch-progress-text')).toBe(
      '批量写章 · 第 4 章（1 / 3）· 已用 0 万 / 上限 18.6 万',
    ),
  );

  // 修订交回来了，但还没写进文件、记账也没落定：不记，也不问下一步。
  await act(async () => first.resolve(autoOutcome(first)));
  await settle();
  expect(engine.recordWriteBatchChapter).not.toHaveBeenCalled();
  expect(engine.nextWriteBatchStep).toHaveBeenCalledTimes(1);
  reportChapterWriteback(first.runId, {
    written: true,
    filePath: `${ROOT}/${path(4)}`,
    snapshotVersion: '.storyforge/versions/正文/第004章.md/checkpoints/1.meta.json',
    factsBefore: '.storyforge/versions/.storyforge/canon/facts.json/checkpoints/2.meta.json',
    factDisputes: 0,
    factsAdded: 3,
    factError: null,
  });
  await until(() => expect(runs).toHaveLength(2));
  expect(engine.recordWriteBatchChapter).toHaveBeenCalledWith({
    projectRoot: ROOT,
    batchId: 'write-batch-1',
    ordinal: 4,
    runId: 'run-1',
    writtenPath: `${ROOT}/${path(4)}`,
    snapshotVersion: '.storyforge/versions/正文/第004章.md/checkpoints/1.meta.json',
    factsBefore: '.storyforge/versions/.storyforge/canon/facts.json/checkpoints/2.meta.json',
    factDisputes: 0,
    factsAdded: 3,
  });
  expect(engine.nextWriteBatchStep).toHaveBeenLastCalledWith({
    projectRoot: ROOT,
    batchId: 'write-batch-1',
    permissionProfile: 'ask',
    modelKey: 'model-a',
  });
  expect(runs[1].goal).toBe('写第 5 章（批量第 2 / 3 章）\n作者要求：节奏快一点');
  expect(grantedProfile(runs[1])).toBe('auto');
  await until(() =>
    expect(text('write-batch-progress-text')).toBe(
      '批量写章 · 第 5 章（2 / 3）· 已用 6 万 / 上限 18.6 万',
    ),
  );
  await finishChapter(1);
  await until(() => expect(runs).toHaveLength(3));
  await finishChapter(2);

  await until(() => expect(q('write-batch-result')).not.toBeNull());
  expect(q('write-batch-progress')).toBeNull();
  expect(text('write-batch-result-title')).toBe('这一批写完了');
  expect(text('write-batch-result-summary')).toBe(
    '这一批写了 3 章（计划 3 章）· 共用 18 万（预估 18.6 万、上限 18.6 万）',
  );
  expect(rows()).toEqual([
    '第 4 章《标题4》 | · 3000 字 | · 检查：通过，有 2 条建议 | · 新记下的事实 3 条 | · 用量 6 万 | 目标：目标4',
    '第 5 章《标题5》 | · 3000 字 | · 检查：通过，有 2 条建议 | · 新记下的事实 3 条 | · 用量 6 万 | 目标：目标5',
    '第 6 章《标题6》 | · 3000 字 | · 检查：通过，有 2 条建议 | · 新记下的事实 3 条 | · 用量 6 万 | 目标：目标6',
  ]);
  // 调度器打开的页签：下一章开写前关掉上一章的，最后一章留着。
  expect(tabs).toEqual([
    { kind: 'before', filePath: `${ROOT}/${path(4)}` },
    { kind: 'close', filePath: `${ROOT}/${path(4)}` },
    { kind: 'before', filePath: `${ROOT}/${path(5)}` },
    { kind: 'close', filePath: `${ROOT}/${path(5)}` },
    { kind: 'before', filePath: `${ROOT}/${path(6)}` },
  ]);
  // 这一批结束，授权跟着撤销。
  expect(grantedProfile(first)).toBe('ask');

  await click('write-batch-reviewed');
  await until(() => expect(q('write-batch-reviewed-done')).not.toBeNull());
  expect(engine.markWriteBatchReviewed).toHaveBeenCalledWith(ROOT, 'write-batch-1');
  expect(q('write-batch-reviewed')).toBeNull();
});

test('开不了（引擎重出计划有新拦法）：确认卡留着，显示新原因，不发起', async () => {
  engine.startWriteBatch.mockImplementationOnce(async () => ({
    started: false,
    batch: null,
    plan: {
      ...plan(4, 6),
      can_start: false,
      blockers: [{ code: 'batch_running', message: '上一批还在写。', chapters: [] }],
    },
  }));
  await submitComposer('/写 4-6');
  await until(() => expect(q('write-batch-start')).not.toBeNull());
  await click('write-batch-start');
  await until(() => expect(text('write-batch-blocker')).toBe('上一批还在写。'));
  expect(q('write-batch-start')).toBeNull();
  expect(h.run).not.toHaveBeenCalled();
});

test('引擎说停：停下的卡照引擎原文说原因，「从第 k 章接着写」重新确认后接着写', async () => {
  engine.steps = [
    { action: 'write', ordinal: 4, target_path: path(4), goal: null },
    {
      action: 'stop',
      code: 'cap_reached',
      message: '这一段已用 6 万 / 上限 6 万 token：第 5 章开写前停下。',
      ordinal: 5,
    },
    { action: 'write', ordinal: 5, target_path: path(5), goal: null },
  ];
  await startBatch();
  await finishChapter(0);
  await until(() => expect(q('write-batch-result')).not.toBeNull());
  expect(text('write-batch-result-title')).toBe('这一批停下了');
  expect(text('write-batch-result-summary')).toBe(
    '这一批写了 1 章（计划 3 章）· 共用 6 万（预估 18.6 万、上限 18.6 万）',
  );
  expect(text('write-batch-stop-reason')).toBe(
    '这一段已用 6 万 / 上限 6 万 token：第 5 章开写前停下。',
  );
  expect(q('write-batch-reviewed')).not.toBeNull();
  // 停下了、最后一章的页签留着。
  expect(tabs.filter((tab) => tab.kind === 'close')).toEqual([]);

  await click('write-batch-resume');
  await until(() => expect(text('write-batch-title')).toBe('从第 5 章接着写'));
  // 确认前只读出计划，记录不动；卡上带着这一批记下的要求。
  expect(engine.previewWriteBatchResume).toHaveBeenCalledWith({
    projectRoot: ROOT,
    permissionProfile: 'ask',
    modelKey: 'model-a',
  });
  expect(engine.resumeWriteBatch).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('要求：节奏快一点');
  expect(runs).toHaveLength(1);
  // 续写确认卡开着时，和 `/写` 确认卡一样不发别的话。
  await submitComposer('先聊聊');
  expect(toasts).toContain('先开始写或关掉上面的批量写章，再发下一条；草稿已保留。');

  await click('write-batch-start');
  await until(() => expect(runs).toHaveLength(2));
  expect(engine.resumeWriteBatch).toHaveBeenCalledWith({
    projectRoot: ROOT,
    permissionProfile: 'ask',
    modelKey: 'model-a',
  });
  expect(engine.startWriteBatch).toHaveBeenCalledTimes(1);
  expect(runs[1].goal).toBe('写第 5 章（批量第 1 / 2 章）\n作者要求：节奏快一点');
  expect(grantedProfile(runs[1])).toBe('auto');
});

test('续写确认卡上点取消：什么都不动，回到停下的卡', async () => {
  engine.steps = [
    { action: 'write', ordinal: 4, target_path: path(4), goal: null },
    { action: 'stop', code: 'trial_done', message: '试写的一章写完了。', ordinal: 5 },
  ];
  await startBatch();
  await finishChapter(0);
  await until(() => expect(q('write-batch-resume')).not.toBeNull());
  await click('write-batch-resume');
  await until(() => expect(q('write-batch-start')).not.toBeNull());
  const stopsBefore = engine.stopWriteBatch.mock.calls.length;
  await click('write-batch-close');
  await until(() => expect(q('write-batch-result')).not.toBeNull());
  expect(engine.resumeWriteBatch).not.toHaveBeenCalled();
  expect(engine.stopWriteBatch.mock.calls.length).toBe(stopsBefore);
  expect(text('write-batch-stop-reason')).toBe('试写的一章写完了。');
  expect(runs).toHaveLength(1);
});

test('作者按停止：走现有的停止本轮，这一章记完就停，不再开下一章', async () => {
  engine.steps = [
    { action: 'write', ordinal: 4, target_path: path(4), goal: null },
    { action: 'write', ordinal: 5, target_path: path(5), goal: null },
  ];
  await startBatch();
  await until(() => expect(q('write-batch-stop')).not.toBeNull());
  await click('write-batch-stop');
  expect(h.stopRun).toHaveBeenCalledTimes(1);
  expect(text('write-batch-stop')).toBe('正在停…');
  await act(async () => runs[0].resolve({ kind: 'settled', runId: 'run-1', proposal: null }));
  await until(() => expect(q('write-batch-result')).not.toBeNull());
  expect(engine.recordWriteBatchChapter).toHaveBeenCalledWith(
    expect.objectContaining({ ordinal: 4, writtenPath: null }),
  );
  expect(engine.stopWriteBatch).toHaveBeenCalledWith({
    projectRoot: ROOT,
    batchId: 'write-batch-1',
    code: 'author_stopped',
    message: '你按了停止，这一批停下了。',
  });
  expect(engine.nextWriteBatchStep).toHaveBeenCalledTimes(1);
  expect(runs).toHaveLength(1);
  expect(text('write-batch-stop-reason')).toBe('你按了停止，这一批停下了。');
});

test.each([
  ['运行失败', { kind: 'settled', runId: 'run-1', proposal: null }, null, 'run_failed'],
  [
    '修订要作者点接受',
    {
      kind: 'settled',
      runId: 'run-1',
      proposal: { patchId: 'p', filePath: `${ROOT}/${path(4)}`, requiresConfirmation: true },
    },
    null,
    'needs_confirmation',
  ],
  [
    '写进文件被拦下',
    {
      kind: 'settled',
      runId: 'run-1',
      proposal: { patchId: 'p', filePath: `${ROOT}/${path(4)}`, requiresConfirmation: false },
    },
    { written: false, reason: '当前文件内容已变化' },
    'writeback_blocked',
  ],
] as const)('%s：记成没写进去，引擎判停，卡上照原文', async (_label, outcome, writeback, code) => {
  engine.steps = [
    { action: 'write', ordinal: 4, target_path: path(4), goal: null },
    { action: 'stop', code, message: `第 4 章停下（${code}）`, ordinal: 4 },
  ];
  await startBatch();
  await act(async () => runs[0].resolve(outcome as RunAuthorAgentOutcome));
  if (writeback) reportChapterWriteback('run-1', writeback);
  await until(() => expect(q('write-batch-result')).not.toBeNull());
  expect(engine.recordWriteBatchChapter).toHaveBeenCalledWith(
    expect.objectContaining({ ordinal: 4, writtenPath: null, snapshotVersion: null }),
  );
  expect(text('write-batch-stop-reason')).toBe(`第 4 章停下（${code}）`);
  expect(runs).toHaveLength(1);
});

test('哪一步出错就停下这一批，卡上显示原因，不重试', async () => {
  engine.steps = [{ action: 'write', ordinal: 4, target_path: path(4), goal: null }];
  engine.recordWriteBatchChapter.mockRejectedValueOnce(
    new Error('写进的文件不是第 4 章的目标文件'),
  );
  await startBatch();
  await finishChapter(0);
  await until(() => expect(q('write-batch-result')).not.toBeNull());
  expect(engine.stopWriteBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      code: 'scheduler_error',
      message: '第 4 章出错停下：写进的文件不是第 4 章的目标文件',
    }),
  );
  expect(text('write-batch-stop-reason')).toBe('第 4 章出错停下：写进的文件不是第 4 章的目标文件');
  expect(runs).toHaveLength(1);
});

test('批量进行中：不能发话、不能切换或新建会话', async () => {
  engine.steps = [{ action: 'write', ordinal: 4, target_path: path(4), goal: null }];
  await startBatch();
  await submitComposer('顺便看看第三章');
  expect(toasts).toContain('批量写章进行中：先停止这一批，再发下一条；草稿已保留。');
  expect(h.run).toHaveBeenCalledTimes(1);
  await act(async () => emitNewSessionRequest());
  expect(h.newSession).not.toHaveBeenCalled();
  await act(async () =>
    h.state!.setAssistantSessions([
      { id: 2, title: '别的会话', updated_at: '2026-10-30T00:00:00Z' } as never,
    ]),
  );
  await click('conversation-session-switch');
  await until(() => expect(q('session-item')).not.toBeNull());
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>('[data-testid="session-item"]')]
      .find((item) => item.textContent?.includes('别的会话'))
      ?.click();
  });
  expect(h.selectSession).not.toHaveBeenCalled();
  expect(toasts).toContain('批量写章进行中：先停止这一批，再切换、新建会话或发起别的修改。');
});

test('换作品：这一批就地停下、这一轮也停掉；晚到的结果不记、授权失效', async () => {
  engine.steps = [{ action: 'write', ordinal: 4, target_path: path(4), goal: null }];
  await startBatch();
  const [first] = runs;
  await render('D:/other-book');
  expect(engine.stopWriteBatch).toHaveBeenCalledWith({
    projectRoot: ROOT,
    batchId: 'write-batch-1',
    code: 'author_stopped',
    message: '换了作品或关掉了对话，这一批停下了。',
  });
  expect(sendAgentControlMessage).toHaveBeenCalledWith(
    expect.objectContaining({ runId: 'run-1', type: 'stop_run' }),
  );
  expect(grantedProfile(first)).toBe('ask');
  await act(async () => first.resolve(autoOutcome(first)));
  reportChapterWriteback('run-1', { written: false, reason: '晚到' });
  await settle();
  await settle();
  expect(engine.recordWriteBatchChapter).not.toHaveBeenCalled();
  expect(runs).toHaveLength(1);
  expect(q('write-batch-progress')).toBeNull();
  expect(q('write-batch-result')).toBeNull();
});

test('不带范围的 /写：能续就重新确认；没有批量就在卡上说明', async () => {
  await submitComposer('/写');
  await until(() =>
    expect(text('write-batch-result-notice')).toBe('这部作品还没有批量写章的记录，没有可续写的。'),
  );
  expect(engine.resumeWriteBatch).not.toHaveBeenCalled();
  await click('write-batch-result-close');

  engine.batch = batchOf(4, 6);
  Object.assign(current().chapters[0], { state: 'written', chars: 3000 });
  current().status = 'stopped';
  current().stop = { code: 'run_failed', message: '第 5 章的运行失败了。', ordinal: 5 };
  await submitComposer('/写');
  await until(() => expect(text('write-batch-title')).toBe('从第 5 章接着写'));
  expect(engine.previewWriteBatchResume).toHaveBeenCalledTimes(1);
  expect(engine.resumeWriteBatch).not.toHaveBeenCalled();
  expect(h.run).not.toHaveBeenCalled();
  // 取消回到下面垫着的那张停下的卡。
  await click('write-batch-close');
  await until(() => expect(text('write-batch-stop-reason')).toBe('第 5 章的运行失败了。'));
});

test('重开作品：上次停下、没审完的那一批在对话里出卡，不自动续', async () => {
  act(() => root.unmount());
  engine.batch = batchOf(4, 6);
  // 作者附的要求在记录里，重开应用也在；章名是引擎读记录时从连载计划取的。
  current().note = '多写对话';
  Object.assign(current().chapters[0], {
    state: 'written',
    chars: 2800,
    check: { verdict: 'pass', issue_count: 0, summary: '通过' },
  });
  current().legs[0].used_tokens = 58_000;
  engine.recoverInterruptedWriteBatch.mockImplementationOnce(async () => {
    current().status = 'stopped';
    current().stop = {
      code: 'app_closed',
      message: '应用上次关闭时这一批还在写，停在第 5 章。没有自动接着写；要续写请再确认一次。',
      ordinal: 5,
    };
    return { recovered: true, batch: copy() };
  });
  root = createRoot(host);
  await render();
  await until(() => expect(q('write-batch-result')).not.toBeNull());
  expect(engine.recoverInterruptedWriteBatch).toHaveBeenCalledWith(ROOT);
  expect(text('write-batch-stop-reason')).toBe(
    '应用上次关闭时这一批还在写，停在第 5 章。没有自动接着写；要续写请再确认一次。',
  );
  expect(rows()).toEqual([
    '第 4 章《标题4》 | · 2800 字 | · 检查：通过 | · 新记下的事实 — | 目标：目标4',
    '第 5 章《标题5》 | · 没写 | 目标：目标5',
    '第 6 章《标题6》 | · 没写 | 目标：目标6',
  ]);
  expect(text('write-batch-resume')).toBe('从第 5 章接着写');
  expect(h.run).not.toHaveBeenCalled();
  // 重开以后续写：确认卡带着记录里的要求，点开始后每章的话也带上。
  await click('write-batch-resume');
  await until(() => expect(text('write-batch-title')).toBe('从第 5 章接着写'));
  expect(document.body.textContent).toContain('要求：多写对话');
  engine.steps = [{ action: 'write', ordinal: 5, target_path: path(5), goal: null }];
  await click('write-batch-start');
  await until(() => expect(runs).toHaveLength(1));
  expect(runs[0].goal).toBe('写第 5 章（批量第 1 / 2 章）\n作者要求：多写对话');
});
