/**
 * `/写` 批量写章的清单与「撤销第 k 章及之后」（F 刀），经真 ChatWindow：
 * 清单各列与汇总（待定事实标出来、对不上的如实标、没有总评）、章名点了打开；
 * 撤销在行内就地两步确认；能不能撤、删哪几章由引擎说，界面倒着删、每章走新建文件撤销的删除路径，
 * 中途失败即停、有不能撤的原因就什么都不动；台账恢复到引擎给的版本；记一笔后刷新清单。
 * 每个用例都是「打开作品时读记录出的清单」：内存里没有这一批，撤销全靠记录，等于重开应用后照样能撤。
 * 引擎（lib/api/write-batch）是假的；判断规则本身由引擎测试钉住。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type {
  ApiWriteBatchUndoPlan,
  ApiWriteBatchView,
  ApiWriteBatchViewChapter,
} from '../src/lib/api/contracts';

vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));
vi.mock('../src/components/chat-window/useRunAuthorAgent', () => ({
  useRunAuthorAgent: () => vi.fn(),
}));
vi.mock('../src/components/chat-window/useChatSessionContext', () => ({
  useChatSessionContext: () => ({
    handleSelectSession: vi.fn(),
    handleNewSession: vi.fn(),
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
    agentRunControls: { onStopRun: vi.fn() },
  }),
}));

const engine = vi.hoisted(() => ({
  view: null as unknown,
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
  planWriteBatchUndo: vi.fn(),
  checkWriteBatchUndoChapter: vi.fn(),
  recordWriteBatchUndo: vi.fn(),
  formatWriteBatchTokens: vi.fn(async (tokens: number) => `${tokens / 10_000} 万`),
  currentWriteBatchModelKey: vi.fn(async () => 'model-a'),
}));
vi.mock('../src/lib/api/write-batch', () => engine);
const effects = vi.hoisted(() => ({
  unmark: vi.fn(async () => null),
  restore: vi.fn(async () => true),
}));
vi.mock('../src/lib/serial-plan', async (load) => ({
  ...(await load<typeof import('../src/lib/serial-plan')>()),
  unmarkChapterWrittenInPlan: effects.unmark,
}));
vi.mock('../src/lib/fact-write', async (load) => ({
  ...(await load<typeof import('../src/lib/fact-write')>()),
  restoreFactsLedger: effects.restore,
}));

import { ChatWindow } from '../src/components/chat-window/ChatWindow';
import { REQUEST_OPEN_FILE_EVENT, type OpenFileRequest } from '../src/lib/assistant-events';
import { TauriFileSystem } from '../src/lib/host/tauri-fs';
import { WRITE_BATCH_TAB_EVENT, type WriteBatchTabRequest } from '../src/lib/write-batch-tabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = 'D:/book';
const ID = 'write-batch-1';
const path = (ordinal: number) => `正文/第${String(ordinal).padStart(3, '0')}章.md`;
const abs = (ordinal: number) => `${ROOT}/${path(ordinal)}`;

function chapter(
  ordinal: number,
  fields: Partial<ApiWriteBatchViewChapter> = {},
): ApiWriteBatchViewChapter {
  return {
    ordinal,
    target_path: path(ordinal),
    state: 'written',
    run_id: `run-${ordinal}`,
    written_sha256: `sha-${ordinal}`,
    chars: 3000,
    check: { verdict: 'pass', issue_count: 0, summary: '通过' },
    tokens: 60_000,
    snapshot_version: `.storyforge/versions/${path(ordinal)}/checkpoints/${ordinal}.meta.json`,
    facts_before: `facts-${ordinal}`,
    fact_disputes: 0,
    facts_added: 2,
    title: `标题${ordinal}`,
    goal: `目标${ordinal}`,
    ...fields,
  };
}

function view(
  chapters: ApiWriteBatchViewChapter[],
  fields: Partial<NonNullable<ApiWriteBatchView['batch']>> = {},
  extra: Partial<ApiWriteBatchView> = {},
): ApiWriteBatchView {
  return {
    batch: {
      version: 3,
      id: ID,
      from: chapters[0].ordinal,
      to: chapters[chapters.length - 1].ordinal,
      created_at: '2026-10-30T00:00:00Z',
      model_key: 'model-a',
      note: null,
      facts_ledger_sha256: null,
      status: 'finished',
      reviewed: false,
      stop: null,
      legs: [
        {
          basis: 'history',
          cap_tokens: 360_000,
          estimated_tokens: 240_000,
          runs: [],
          started_at: '2026-10-30T00:00:00Z',
          used_tokens: chapters.reduce((sum, item) => sum + (item.tokens ?? 0), 0),
        },
      ],
      chapters,
      ...fields,
    },
    mismatches: [],
    can_resume: false,
    resume_from: null,
    ...extra,
  };
}

/** 引擎给的撤销计划：从 from 到最后一章倒着排，台账删到哪章就回到已删各章里最早记账前。 */
function undoPlan(
  from: number,
  to: number,
  factsLedger: ApiWriteBatchUndoPlan['facts_ledger'] = 'unchanged',
): ApiWriteBatchUndoPlan {
  const chapters = [];
  for (let ordinal = to; ordinal >= from; ordinal -= 1)
    chapters.push({
      ordinal,
      target_path: path(ordinal),
      written_sha256: `sha-${ordinal}`,
      facts_restore: `facts-${ordinal}`,
    });
  return {
    batch_id: ID,
    from,
    to,
    chapters,
    facts_before: `facts-${from}`,
    facts_ledger: factsLedger,
    blockers: [],
    can_undo: true,
  };
}

let root: Root;
let host: HTMLDivElement;
let order: string[];
let opened: string[];
let dirty: Set<string>;
const onOpen = (event: Event) =>
  opened.push((event as CustomEvent<OpenFileRequest>).detail.filePath);
const onTab = (event: Event) => {
  const request = (event as CustomEvent<WriteBatchTabRequest>).detail;
  if (request.kind === 'dirty') request.dirty = dirty.has(request.filePath);
  if (request.kind === 'drop') order.push(`drop:${request.filePath}`);
};

const q = <T extends Element = HTMLElement>(testid: string, scope: ParentNode = document) =>
  scope.querySelector<T & HTMLElement>(`[data-testid="${testid}"]`);
const text = (testid: string) => q(testid)?.textContent ?? null;
const row = (ordinal: number) =>
  document.querySelector<HTMLElement>(
    `[data-testid="write-batch-result-chapter"][data-ordinal="${ordinal}"]`,
  )!;
const PARTS = [
  'write-batch-row-open',
  'write-batch-row-name',
  'write-batch-row-chars',
  'write-batch-row-check',
  'write-batch-row-facts',
  'write-batch-row-tokens',
  'write-batch-row-goal',
  'write-batch-row-facts-warning',
  'write-batch-row-mismatch',
];
const rows = () =>
  [...document.querySelectorAll('[data-testid="write-batch-result-chapter"]')].map((item) =>
    PARTS.map((id) => item.querySelector(`[data-testid="${id}"]`)?.textContent ?? null)
      .filter((part) => part !== null)
      .join(' | '),
  );
const press = async (element: HTMLElement | null) =>
  act(async () => {
    element!.click();
  });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
async function until(assertion: () => void) {
  await vi.waitFor(async () => {
    await settle();
    assertion();
  });
}

/** 打开作品：读记录，停下或写完、没审完的那一批出清单。 */
async function openBook(initial: ApiWriteBatchView) {
  engine.view = initial;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<ChatWindow projectPath={ROOT} currentFile={null} assistantSessionId={1} />),
  );
  await until(() => expect(q('write-batch-result')).not.toBeNull());
}

/** 行尾「撤销这章及之后」：第一次点（只读地问引擎能不能撤），等确认出来再点确认。 */
async function undoFrom(ordinal: number) {
  await press(q('write-batch-undo', row(ordinal)));
  await until(() => expect(q('write-batch-undo-confirm', row(ordinal))).not.toBeNull());
  await press(q('write-batch-undo-confirm', row(ordinal)));
}

const SHORT_FACTS = (from: number) => `事实台账会回到第 ${from} 章记账之前的样子。`;
const FULL_FACTS = (from: number) =>
  `事实台账会回到第 ${from} 章记账之前的样子；之后你在观测镜里对事实的改动也会一起回退（回退前留了快照，能在版本历史里找回）。`;

let deletePath: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  opened = [];
  dirty = new Set();
  engine.readWriteBatch.mockImplementation(async () => structuredClone(engine.view));
  engine.recoverInterruptedWriteBatch.mockImplementation(async () => ({
    recovered: false,
    batch: (engine.view as ApiWriteBatchView).batch,
  }));
  engine.checkWriteBatchUndoChapter.mockImplementation(
    async (_root: string, _id: string, ordinal: number) => {
      order.push(`check:${ordinal}`);
      return null;
    },
  );
  engine.recordWriteBatchUndo.mockImplementation(
    async (input: { deleted: number[]; failure: string | null }) => {
      order.push(`record:${input.deleted.join(',')}`);
      const current = engine.view as ApiWriteBatchView;
      const batch = current.batch!;
      for (const item of batch.chapters)
        if (input.deleted.includes(item.ordinal)) item.state = 'undone';
      const first = Math.min(...input.deleted);
      batch.status = 'stopped';
      batch.stop = { code: 'undone', message: `撤销了第 ${first} 章起的章。`, ordinal: first };
      engine.view = { ...current, can_resume: true, resume_from: first };
      return batch;
    },
  );
  deletePath = vi
    .spyOn(TauriFileSystem, 'deletePath')
    .mockImplementation(async (_root: string, filePath: string) => {
      order.push(`delete:${filePath}`);
    });
  effects.unmark.mockImplementation(async (_root: string | null, filePath: string) => {
    order.push(`unmark:${filePath}`);
    return null;
  });
  effects.restore.mockImplementation(async (_root: string, version: string) => {
    order.push(`restore:${version}`);
    return true;
  });
  window.addEventListener(REQUEST_OPEN_FILE_EVENT, onOpen);
  window.addEventListener(WRITE_BATCH_TAB_EVENT, onTab);
});
afterEach(() => {
  window.removeEventListener(REQUEST_OPEN_FILE_EVENT, onOpen);
  window.removeEventListener(WRITE_BATCH_TAB_EVENT, onTab);
  deletePath.mockRestore();
  act(() => root.unmount());
  host.remove();
});

test('清单：汇总、每章各列、待定事实标出来、对不上的如实标，没有总评；章名点了打开那一章', async () => {
  await openBook(
    view(
      [
        chapter(4, {
          check: { verdict: 'pass', issue_count: 2, summary: '对照章纲没查出问题，有 2 条建议' },
          facts_added: 3,
          fact_disputes: 1,
        }),
        chapter(5, {
          check: { verdict: 'pass', issue_count: 0, summary: '修过一次后对照章纲没查出问题' },
          facts_added: 0,
          chars: 2800,
          tokens: 90_000,
        }),
        chapter(6, {
          state: 'stopped_here',
          chars: null,
          check: { verdict: 'blocked', issue_count: 1, summary: '检查拦下：1 个硬问题' },
          facts_added: null,
          fact_disputes: null,
          facts_before: null,
          written_sha256: null,
          tokens: 70_000,
        }),
        chapter(7, {
          state: 'pending',
          run_id: null,
          chars: null,
          check: null,
          tokens: null,
          facts_added: null,
          fact_disputes: null,
          facts_before: null,
          written_sha256: null,
          snapshot_version: null,
          title: null,
          goal: null,
        }),
      ],
      {
        status: 'stopped',
        stop: {
          code: 'check_blocked',
          message: '第 6 章检查拦下了（检查拦下：1 个硬问题）。',
          ordinal: 6,
        },
      },
      {
        mismatches: [
          {
            ordinal: 5,
            kind: 'changed',
            message: '第 5 章写进文件以后又改过，和写进去时的内容对不上：以正文为准。',
          },
        ],
        can_resume: true,
        resume_from: 6,
      },
    ),
  );
  expect(text('write-batch-result-title')).toBe('这一批停下了');
  expect(text('write-batch-result-summary')).toBe(
    '这一批写了 2 章（计划 4 章）· 共用 22 万（预估 24 万、上限 36 万）',
  );
  expect(text('write-batch-stop-reason')).toBe('第 6 章检查拦下了（检查拦下：1 个硬问题）。');
  expect(rows()).toEqual([
    '第 4 章《标题4》 | · 3000 字 | · 检查：对照章纲没查出问题，有 2 条建议 | · 新记下的事实 4 条（其中待定 1 条） | · 用量 6 万 | 目标：目标4',
    '第 5 章《标题5》 | · 2800 字 | · 检查：修过一次后对照章纲没查出问题 | · 新记下的事实 0 条 | · 用量 9 万 | 目标：目标5 | 这章没抽出新事实，事实台账可能漏了这章的内容。 | 第 5 章写进文件以后又改过，和写进去时的内容对不上：以正文为准。',
    '第 6 章《标题6》 | · 没写（停在这里），检查拦下：1 个硬问题 | · 用量 7 万 | 目标：目标6',
    '第 7 章 | · 没写',
  ]);
  // 待定的标出来；一条新事实都没记下的章照警示的样子提醒；只有写进文件的章能撤。
  expect(q('write-batch-row-pending', row(4))?.className).toContain('text-warning');
  expect(q('write-batch-row-pending', row(5))).toBeNull();
  expect(q('write-batch-row-facts-warning', row(5))?.className).toContain('text-warning');
  expect(q('write-batch-row-facts-warning', row(4))).toBeNull();
  expect([4, 5, 6, 7].map((ordinal) => q('write-batch-undo', row(ordinal)) !== null)).toEqual([
    true,
    true,
    false,
    false,
  ]);
  // 检查只对照章纲：清单下写明一次，免得「没查出问题」被读成前后文都核过。
  expect(text('write-batch-check-scope')).toContain('章纲没写到的前文和设定没有核对');
  // 不放质量分、通过率之类的总评。
  const card = text('write-batch-result') ?? '';
  for (const word of ['通过率', '%', '评分', '质量', '得分']) expect(card).not.toContain(word);
  // 底部常驻：审完、接着写、关闭。
  const footer = q('write-batch-result-footer')!;
  expect(q('write-batch-reviewed', footer)).not.toBeNull();
  expect(q('write-batch-resume', footer)?.textContent).toBe('从第 6 章接着写');
  expect(q('write-batch-result-close', footer)).not.toBeNull();

  await press(q('write-batch-row-open', row(4)));
  expect(opened).toEqual([abs(4)]);
  expect(q('write-batch-row-open', row(6))).toBeNull();
});

test('撤销先在行内就地两步确认：第一次点只读地问引擎、变成确认与取消，取消什么都不做', async () => {
  await openBook(view([chapter(4), chapter(5), chapter(6)]));
  engine.planWriteBatchUndo.mockResolvedValue(undoPlan(5, 6));
  await press(q('write-batch-undo', row(5)));
  await until(() =>
    expect(q('write-batch-undo-confirm', row(5))?.textContent).toBe('确认撤销第 5–6 章？'),
  );
  expect(engine.planWriteBatchUndo).toHaveBeenCalledWith(ROOT, ID, 5);
  expect(q('write-batch-undo-cancel', row(5))).not.toBeNull();
  await press(q('write-batch-undo-cancel', row(5)));
  expect(q('write-batch-undo-confirm', row(5))).toBeNull();
  expect(q('write-batch-undo-facts')).toBeNull();
  expect(q('write-batch-undo', row(5))).not.toBeNull();
  // 最后一章只撤它自己。
  engine.planWriteBatchUndo.mockResolvedValue(undoPlan(6, 6));
  await press(q('write-batch-undo', row(6)));
  await until(() =>
    expect(q('write-batch-undo-confirm', row(6))?.textContent).toBe('确认撤销第 6 章？'),
  );
  // 第一次点只读：没删、没核、没恢复、没记。
  expect(deletePath).not.toHaveBeenCalled();
  expect(engine.checkWriteBatchUndoChapter).not.toHaveBeenCalled();
  expect(effects.restore).not.toHaveBeenCalled();
  expect(engine.recordWriteBatchUndo).not.toHaveBeenCalled();
});

test.each([
  ['台账在这一批之后没动过：只说回到哪', 'unchanged', SHORT_FACTS(4), 'false'],
  ['作者之后改过台账：完整警告，醒目', 'changed', FULL_FACTS(4), 'true'],
  ['说不准：照样给完整那句', 'unknown', FULL_FACTS(4), 'false'],
] as const)('确认撤销时写明台账会整份回退——%s', async (_name, ledger, sentence, emphasis) => {
  await openBook(view([chapter(4), chapter(5)]));
  engine.planWriteBatchUndo.mockResolvedValue(undoPlan(4, 5, ledger));
  await press(q('write-batch-undo', row(4)));
  await until(() => expect(q('write-batch-undo-confirm', row(4))).not.toBeNull());
  const notice = q('write-batch-undo-facts', row(4))!;
  expect(notice.textContent).toBe(sentence);
  expect(notice.dataset.emphasis).toBe(emphasis);
  expect(notice.className.includes('text-warning')).toBe(emphasis === 'true');
});

test('一章都没写进文件：不出检查范围那句说明', async () => {
  await openBook(
    view(
      [
        chapter(4, {
          state: 'stopped_here',
          chars: null,
          check: { verdict: 'blocked', issue_count: 1, summary: '检查拦下：1 个硬问题' },
          facts_added: null,
          fact_disputes: null,
          facts_before: null,
          written_sha256: null,
        }),
      ],
      {
        status: 'stopped',
        stop: { code: 'check_blocked', message: '第 4 章检查拦下了。', ordinal: 4 },
      },
    ),
  );
  expect(q('write-batch-check-scope')).toBeNull();
});

test('这几章都没记过账：不提台账', async () => {
  await openBook(view([chapter(4, { facts_before: null }), chapter(5, { facts_before: null })]));
  engine.planWriteBatchUndo.mockResolvedValue({
    ...undoPlan(4, 5),
    chapters: undoPlan(4, 5).chapters.map((item) => ({ ...item, facts_restore: null })),
    facts_before: null,
    facts_ledger: null,
  });
  await press(q('write-batch-undo', row(4)));
  await until(() => expect(q('write-batch-undo-confirm', row(4))).not.toBeNull());
  expect(q('write-batch-undo-facts')).toBeNull();
});

test('确认后：照引擎的顺序倒着删、每章删前再核、计划里退回未写、页签摘掉；台账回到第 k 章记账前，记一笔、刷新清单', async () => {
  await openBook(view([chapter(4), chapter(5), chapter(6)]));
  engine.planWriteBatchUndo.mockResolvedValue(undoPlan(4, 6));
  await undoFrom(4);
  await until(() => expect(text('write-batch-stop-reason')).toBe('撤销了第 4 章起的章。'));
  expect(engine.planWriteBatchUndo).toHaveBeenCalledWith(ROOT, ID, 4);
  expect(order).toEqual([
    'check:6',
    `delete:${abs(6)}`,
    `unmark:${abs(6)}`,
    `drop:${abs(6)}`,
    'check:5',
    `delete:${abs(5)}`,
    `unmark:${abs(5)}`,
    `drop:${abs(5)}`,
    'check:4',
    `delete:${abs(4)}`,
    `unmark:${abs(4)}`,
    `drop:${abs(4)}`,
    'restore:facts-4',
    'record:6,5,4',
  ]);
  expect(effects.restore).toHaveBeenCalledWith(ROOT, 'facts-4');
  expect(engine.recordWriteBatchUndo).toHaveBeenCalledWith({
    projectRoot: ROOT,
    batchId: ID,
    fromOrdinal: 4,
    deleted: [6, 5, 4],
    failure: null,
    factsRestored: true,
    factsError: null,
  });
  // 刷新后的清单：撤过的章标已撤销、不能再撤，能从第 4 章接着写。
  expect(rows().map((item) => item.split(' | ').slice(0, 2).join(' | '))).toEqual([
    '第 4 章《标题4》 | · 已撤销',
    '第 5 章《标题5》 | · 已撤销',
    '第 6 章《标题6》 | · 已撤销',
  ]);
  expect(q('write-batch-undo')).toBeNull();
  expect(text('write-batch-resume')).toBe('从第 4 章接着写');
  expect(text('write-batch-result-error')).toBeNull();
});

test('删到一半没删成：立刻停、不接着删，删掉了的照实记，台账只回到已删各章最早记账前', async () => {
  await openBook(view([chapter(4), chapter(5), chapter(6)]));
  engine.planWriteBatchUndo.mockResolvedValue(undoPlan(4, 6));
  deletePath.mockImplementation(async (_root: string, filePath: string) => {
    order.push(`delete:${filePath}`);
    if (filePath === abs(5)) throw new Error('文件被占用');
  });
  await undoFrom(4);
  await until(() => expect(engine.recordWriteBatchUndo).toHaveBeenCalled());
  expect(order).toEqual([
    'check:6',
    `delete:${abs(6)}`,
    `unmark:${abs(6)}`,
    `drop:${abs(6)}`,
    'check:5',
    `delete:${abs(5)}`,
    'restore:facts-6',
    'record:6',
  ]);
  expect(engine.checkWriteBatchUndoChapter).not.toHaveBeenCalledWith(ROOT, ID, 4);
  expect(engine.recordWriteBatchUndo).toHaveBeenCalledWith(
    expect.objectContaining({
      fromOrdinal: 4,
      deleted: [6],
      failure: '第 5 章没删成：文件被占用',
      factsRestored: true,
    }),
  );
});

test('删前再核时引擎说这一章改过了：停在这里，后面的章不删', async () => {
  await openBook(view([chapter(4), chapter(5), chapter(6)]));
  engine.planWriteBatchUndo.mockResolvedValue(undoPlan(4, 6));
  engine.checkWriteBatchUndoChapter.mockImplementation(
    async (_root: string, _id: string, ordinal: number) => {
      order.push(`check:${ordinal}`);
      return ordinal === 5
        ? { code: 'changed', message: '第 5 章写进文件以后改过。', chapters: [5] }
        : null;
    },
  );
  await undoFrom(4);
  await until(() => expect(engine.recordWriteBatchUndo).toHaveBeenCalled());
  expect(deletePath).toHaveBeenCalledTimes(1);
  expect(deletePath).toHaveBeenCalledWith(ROOT, abs(6));
  expect(engine.recordWriteBatchUndo).toHaveBeenCalledWith(
    expect.objectContaining({ deleted: [6], failure: '第 5 章写进文件以后改过。' }),
  );
});

test('引擎说不能撤：原因放在卡上，什么都不删、不恢复、不记', async () => {
  await openBook(view([chapter(4), chapter(5)]));
  engine.planWriteBatchUndo.mockResolvedValue({
    ...undoPlan(4, 5),
    can_undo: false,
    blockers: [
      {
        code: 'changed',
        message:
          '第 5 章写进文件以后改过，和写进去时的内容对不上：撤销会吃掉你的改动，先自己处理这几章。',
        chapters: [5],
      },
      { code: 'outside_chapters', message: '第 6 章不是这一批写的正文。', chapters: [6] },
    ],
  });
  // 第一次点就问出来了：不出确认，原因放在卡上。
  await press(q('write-batch-undo', row(4)));
  await until(() => expect(q('write-batch-undo-blockers')).not.toBeNull());
  expect(q('write-batch-undo-confirm')).toBeNull();
  expect(
    [...document.querySelectorAll('[data-testid="write-batch-undo-blocker"]')].map(
      (item) => item.textContent,
    ),
  ).toEqual([
    '第 5 章写进文件以后改过，和写进去时的内容对不上：撤销会吃掉你的改动，先自己处理这几章。',
    '第 6 章不是这一批写的正文。',
  ]);
  expect(deletePath).not.toHaveBeenCalled();
  expect(engine.checkWriteBatchUndoChapter).not.toHaveBeenCalled();
  expect(effects.restore).not.toHaveBeenCalled();
  expect(engine.recordWriteBatchUndo).not.toHaveBeenCalled();
  // 还能再点（什么都没动）。
  expect(q('write-batch-undo', row(4))).not.toBeNull();
});

test('确认以后再出计划时变成不能撤了：原因放在卡上，什么都不删', async () => {
  await openBook(view([chapter(4), chapter(5)]));
  engine.planWriteBatchUndo.mockResolvedValueOnce(undoPlan(4, 5)).mockResolvedValueOnce({
    ...undoPlan(4, 5),
    can_undo: false,
    blockers: [{ code: 'changed', message: '第 5 章写进文件以后改过。', chapters: [5] }],
  });
  await undoFrom(4);
  await until(() => expect(text('write-batch-undo-blocker')).toBe('第 5 章写进文件以后改过。'));
  expect(deletePath).not.toHaveBeenCalled();
  expect(engine.recordWriteBatchUndo).not.toHaveBeenCalled();
});

test('编辑器里有没保存的字：一章都不删', async () => {
  await openBook(view([chapter(4), chapter(5)]));
  engine.planWriteBatchUndo.mockResolvedValue(undoPlan(4, 5));
  dirty.add(abs(4));
  await undoFrom(4);
  await until(() =>
    expect(text('write-batch-undo-blocker')).toBe(
      '第 4 章在编辑器里有未保存的修改：先保存或放弃，再撤销。',
    ),
  );
  expect(deletePath).not.toHaveBeenCalled();
  expect(engine.recordWriteBatchUndo).not.toHaveBeenCalled();
});

test('台账没能恢复、记录没记上：删了的照实说，错误留在卡上', async () => {
  await openBook(view([chapter(4), chapter(5)]));
  engine.planWriteBatchUndo.mockResolvedValue(undoPlan(5, 5));
  effects.restore.mockRejectedValue(new Error('facts.json 刚被别处改过'));
  engine.recordWriteBatchUndo.mockRejectedValue(new Error('批量记录写不进去'));
  await undoFrom(5);
  await until(() => expect(q('write-batch-result-error')).not.toBeNull());
  expect(engine.recordWriteBatchUndo).toHaveBeenCalledWith(
    expect.objectContaining({
      deleted: [5],
      factsRestored: false,
      factsError: 'facts.json 刚被别处改过',
    }),
  );
  expect(text('write-batch-result-error')).toBe(
    '撤销删了第 5 章，但批量记录没记上：批量记录写不进去；事实台账没能恢复：facts.json 刚被别处改过',
  );
});

test('一条新事实都没记下才提醒：有待定的、记录里没有条数的、没写进文件的都不提醒', async () => {
  await openBook(
    view(
      [
        chapter(4, { facts_added: 0, fact_disputes: 1 }),
        chapter(5, { facts_added: null, fact_disputes: null }),
        chapter(6, { facts_added: 0, fact_disputes: 0 }),
        chapter(7, {
          state: 'stopped_here',
          chars: null,
          facts_added: 0,
          fact_disputes: 0,
          written_sha256: null,
        }),
      ],
      { status: 'stopped', stop: { code: 'check_blocked', message: '停在第 7 章。', ordinal: 7 } },
    ),
  );
  expect(
    [4, 5, 6, 7].map((ordinal) => q('write-batch-row-facts', row(ordinal))?.textContent ?? null),
  ).toEqual([
    '· 新记下的事实 1 条（其中待定 1 条）',
    '· 新记下的事实 —',
    '· 新记下的事实 0 条',
    null,
  ]);
  expect(
    [4, 5, 6, 7].map(
      (ordinal) => q('write-batch-row-facts-warning', row(ordinal))?.textContent ?? null,
    ),
  ).toEqual([null, null, '这章没抽出新事实，事实台账可能漏了这章的内容。', null]);
});

test('撤销以后那一行只说已撤销：不再报新记下的事实（台账已经回退），也不再提醒没抽出事实', async () => {
  await openBook(view([chapter(4), chapter(5, { facts_added: 0, fact_disputes: 0 })]));
  expect(q('write-batch-row-facts-warning', row(5))).not.toBeNull();
  engine.planWriteBatchUndo.mockResolvedValue(undoPlan(4, 5));
  await undoFrom(4);
  await until(() => expect(text('write-batch-stop-reason')).toBe('撤销了第 4 章起的章。'));
  expect(rows()).toEqual([
    '第 4 章《标题4》 | · 已撤销 | · 用量 6 万 | 目标：目标4',
    '第 5 章《标题5》 | · 已撤销 | · 用量 6 万 | 目标：目标5',
  ]);
  for (const ordinal of [4, 5]) {
    expect(q('write-batch-row-facts', row(ordinal))).toBeNull();
    expect(q('write-batch-row-facts-warning', row(ordinal))).toBeNull();
  }
});

test('撤销的第二步在那一行里：台账说明与确认、取消挨在一起，展开时滚进视野', async () => {
  const scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  try {
    await openBook(view([chapter(4), chapter(5), chapter(6)]));
    engine.planWriteBatchUndo.mockResolvedValue(undoPlan(6, 6));
    await press(q('write-batch-undo', row(6)));
    await until(() => expect(q('write-batch-undo-confirm', row(6))).not.toBeNull());
    const block = q('write-batch-undo-confirm-block', row(6))!;
    expect(block).not.toBeNull();
    // 说明、确认、取消都在这一块里，这一块在第 6 章那一行里；行尾不再留「撤销这章及之后」。
    expect(block.contains(q('write-batch-undo-facts'))).toBe(true);
    expect(block.contains(q('write-batch-undo-confirm'))).toBe(true);
    expect(block.contains(q('write-batch-undo-cancel'))).toBe(true);
    expect(q('write-batch-undo-facts')?.textContent).toBe(SHORT_FACTS(6));
    expect(q('write-batch-undo', row(6))).toBeNull();
    expect(q('write-batch-undo-confirm-block', q('write-batch-result-footer')!)).toBeNull();
    expect(scrolled).toEqual([block]);
    // 换到另一行确认：那一行的确认块滚进视野。
    engine.planWriteBatchUndo.mockResolvedValue(undoPlan(5, 6));
    await press(q('write-batch-undo-cancel', row(6)));
    await press(q('write-batch-undo', row(5)));
    await until(() => expect(q('write-batch-undo-confirm', row(5))).not.toBeNull());
    expect(scrolled).toEqual([block, q('write-batch-undo-confirm-block', row(5))]);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test('删掉了章：清掉正文派生的 canon 缓存（与写进文件后宿主清的同一张单子），再恢复台账', async () => {
  const derived = (name: string) => `${ROOT}/.storyforge/canon/derived/${name}`;
  const exists = vi
    .spyOn(TauriFileSystem, 'projectPathExists')
    .mockImplementation(
      async (_root: string, filePath: string) => filePath !== derived('report.json'),
    );
  try {
    await openBook(view([chapter(4), chapter(5)]));
    engine.planWriteBatchUndo.mockResolvedValue(undoPlan(5, 5));
    await undoFrom(5);
    await until(() => expect(engine.recordWriteBatchUndo).toHaveBeenCalled());
    expect(order).toEqual([
      'check:5',
      `delete:${abs(5)}`,
      `unmark:${abs(5)}`,
      `drop:${abs(5)}`,
      `delete:${derived('presence.json')}`,
      `delete:${derived('observations.json')}`,
      `delete:${derived('dossier.md')}`,
      'restore:facts-5',
      'record:5',
    ]);
  } finally {
    exists.mockRestore();
  }
});

test('一章都没删成：不动派生缓存', async () => {
  const exists = vi.spyOn(TauriFileSystem, 'projectPathExists').mockResolvedValue(true);
  try {
    await openBook(view([chapter(4), chapter(5)]));
    engine.planWriteBatchUndo.mockResolvedValue(undoPlan(5, 5));
    deletePath.mockImplementation(async (_root: string, filePath: string) => {
      order.push(`delete:${filePath}`);
      throw new Error('文件被占用');
    });
    await undoFrom(5);
    await until(() => expect(q('write-batch-result-error')).not.toBeNull());
    expect(order).toEqual(['check:5', `delete:${abs(5)}`]);
  } finally {
    exists.mockRestore();
  }
});
