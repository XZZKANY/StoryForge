/**
 * 老章补录接在真实的 useObservatory 上：先在原地说清要调几次模型、作者确定才开始，
 * 跑的时候显示进度；全部抽完一次写 facts.json（一次快照），右下角可整批撤销。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MAX_BACKFILL_CHAPTERS } from '@storyforge/engine';

import { useObservatory } from '../src/components/app/useObservatory';
import { ObservatoryView } from '../src/components/shell/ObservatoryView';
import {
  BACKFILL_BATCH,
  listUnrecordedChapters,
  prepareFactBackfill,
  type FactBackfillPlan,
} from '../src/lib/api/facts';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { backfillMessage, factsLedgerPathFor } from '../src/lib/fact-write';
import { invalidateFileSystemCache, TauriFileSystem } from '../src/lib/host/tauri-fs';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';
import { snapshotBeforeWrite } from '../src/lib/versions';

vi.mock('../src/lib/api/ide-commands', () => ({ executeIdeCommand: vi.fn() }));
vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: vi.fn(async () => null) }));
vi.mock('../src/lib/api/facts', () => ({
  BACKFILL_BATCH: 20,
  retireLedgerFact: vi.fn(),
  listUnrecordedChapters: vi.fn(),
  prepareFactBackfill: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = '/books/backfill';
const PATH = factsLedgerPathFor(PROJECT);
const AFTER = '{"version": 1, "facts": ["…"]}\n';
const chapters = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    path: `正文/第${String(index + 1).padStart(3, '0')}章.md`,
    ordinal: index + 1,
  }));
const CONFLICT = {
  kind: '关系',
  subject: '陈默',
  attribute: '兄弟姐妹',
  value: '有个姐姐',
  quote: '陈默想起了姐姐。',
  existingValue: '独子',
  existingPath: '正文/第001章.md',
  existingOrdinal: 1,
};
const READY: FactBackfillPlan = {
  status: 'ready',
  added: 5,
  before: null,
  after: AFTER,
  chapters: [
    {
      path: '正文/第001章.md',
      ordinal: 1,
      status: 'done',
      added: 3,
      unverified: 0,
      conflicts: [],
      message: null,
    },
    {
      path: '正文/第002章.md',
      ordinal: 2,
      status: 'done',
      added: 2,
      unverified: 1,
      conflicts: [CONFLICT],
      message: null,
    },
  ],
};

let disk: Map<string, string>;
let toasts: ToastDetail[];
let root: Root;
let container: HTMLDivElement;
const onToast = (event: Event) => toasts.push((event as CustomEvent<ToastDetail>).detail);
const dialogs = { confirm: vi.fn(async () => true), prompt: vi.fn(async () => null) };

function Harness() {
  const obs = useObservatory({ activeProject: PROJECT, dialogs });
  return (
    <ObservatoryView
      {...obs}
      onRescan={() => void obs.runScan()}
      onBackToChat={() => {}}
      factBackfill={obs.factBackfill}
    />
  );
}

const mount = async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => {});
};
const byTestId = (testid: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const click = (testid: string) =>
  act(async () => {
    byTestId(testid)!.click();
  });

beforeEach(() => {
  disk = new Map();
  toasts = [];
  window.addEventListener(TOAST_EVENT, onToast);
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => disk.has(path),
    readFile: (path) => disk.get(path) ?? '',
    writeFile: (path, content) => void disk.set(path, content),
  };
  vi.spyOn(TauriFileSystem, 'deletePath').mockImplementation(async (_root, path) => {
    disk.delete(path);
  });
  vi.mocked(executeIdeCommand).mockResolvedValue({
    command_id: 'observatory.scan',
    status: 'accepted',
    payload: { observatory: { generated_at: '2026-10-18T00:00:00Z' } },
  } as never);
  vi.mocked(listUnrecordedChapters).mockReset().mockResolvedValue(chapters(2));
  vi.mocked(prepareFactBackfill).mockReset().mockResolvedValue(READY);
  vi.mocked(snapshotBeforeWrite).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.removeEventListener(TOAST_EVENT, onToast);
  delete window.__STORYFORGE_MOCK_FS__;
  invalidateFileSystemCache();
  vi.restoreAllMocks();
});

test('the batch size matches the engine', () => {
  expect(BACKFILL_BATCH).toBe(MAX_BACKFILL_CHAPTERS);
});

test('asks in place how many model calls it will make, and can be cancelled', async () => {
  await mount();
  expect(byTestId('obs-facts-backfill')?.textContent).toContain('还有 2 章没记账');
  await click('obs-facts-backfill-start');
  expect(byTestId('obs-facts-backfill')?.textContent).toContain(
    '补录第 1–2 章，共 2 章，会调用你配置的模型 2 次。',
  );
  await click('obs-facts-backfill-cancel');
  expect(prepareFactBackfill).not.toHaveBeenCalled();
  expect(byTestId('obs-facts-backfill-start')).not.toBeNull();
});

test('runs with progress, writes once after a snapshot, and undoes the whole batch', async () => {
  let release!: () => void;
  vi.mocked(prepareFactBackfill).mockImplementation(async (_input, onProgress) => {
    onProgress?.(1, 2, '正文/第002章.md');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return READY;
  });
  await mount();
  await click('obs-facts-backfill-start');
  await click('obs-facts-backfill-confirm');
  expect(byTestId('obs-facts-backfill-progress')?.textContent).toBe('补录中 2/2：第 2 章…');
  expect(prepareFactBackfill).toHaveBeenCalledWith(
    { projectRoot: PROJECT, ledgerText: null, paths: ['正文/第001章.md', '正文/第002章.md'] },
    expect.any(Function),
  );
  await act(async () => release());
  expect(disk.get(PATH)).toBe(AFTER);
  expect(snapshotBeforeWrite).toHaveBeenCalledOnce();
  expect(snapshotBeforeWrite).toHaveBeenCalledWith(PROJECT, PATH, '', {
    source: 'Editor',
    summary: '事实台账补录 2 章，记下 5 条事实',
    checkpoint: true,
  });
  const toast = toasts.at(-1)!;
  expect(toast.message).toBe(
    '补录 2 章，记下 5 条事实；1 条和已记的事实对不上、先不用，等你在观测镜里定：陈默的兄弟姐妹，本章「有个姐姐」，第 1 章「独子」。',
  );
  expect(toast.action?.label).toBe('撤销补录');
  await act(async () => {
    await toast.action!.run();
  });
  expect(disk.has(PATH)).toBe(false);
  expect(byTestId('obs-facts-backfill-progress')).toBeNull();
});

test('does at most one batch per click', async () => {
  vi.mocked(listUnrecordedChapters).mockResolvedValue(chapters(23));
  await mount();
  expect(byTestId('obs-facts-backfill')?.textContent).toContain('一次补 20 章');
  await click('obs-facts-backfill-start');
  expect(byTestId('obs-facts-backfill')?.textContent).toContain(
    '补录第 1–20 章，共 20 章，会调用你配置的模型 20 次。',
  );
  await click('obs-facts-backfill-confirm');
  expect(vi.mocked(prepareFactBackfill).mock.calls[0][0].paths).toHaveLength(20);
});

test('writes nothing when nothing new came out, and says why a run failed', async () => {
  vi.mocked(prepareFactBackfill).mockResolvedValue({
    status: 'unchanged',
    added: 0,
    chapters: [
      {
        path: '正文/第001章.md',
        ordinal: 1,
        status: 'failed',
        added: 0,
        unverified: 0,
        conflicts: [],
        message: '额度用完了',
      },
    ],
  });
  await mount();
  await click('obs-facts-backfill-start');
  await click('obs-facts-backfill-confirm');
  expect(disk.has(PATH)).toBe(false);
  expect(snapshotBeforeWrite).not.toHaveBeenCalled();
  expect(toasts.at(-1)).toMatchObject({
    tone: 'error',
    message: '补录 0 章，记下 0 条事实；第 1 章没抽成（额度用完了）。',
  });
  expect(toasts.at(-1)?.action).toBeUndefined();

  vi.mocked(prepareFactBackfill).mockRejectedValue(
    new Error('还没配置模型：补录要调用模型抽事实，先在设置里配好。'),
  );
  await click('obs-facts-backfill-start');
  await click('obs-facts-backfill-confirm');
  expect(toasts.at(-1)).toMatchObject({
    tone: 'error',
    message: '补录没完成：还没配置模型：补录要调用模型抽事实，先在设置里配好。',
  });
});

test('a ledger changed during the run is left alone', async () => {
  vi.mocked(prepareFactBackfill).mockImplementation(async () => {
    disk.set(PATH, 'hand edit');
    return READY;
  });
  await mount();
  await click('obs-facts-backfill-start');
  await click('obs-facts-backfill-confirm');
  expect(disk.get(PATH)).toBe('hand edit');
  expect(toasts.at(-1)?.message).toContain('facts.json 在补录期间被改过了');
});

test('the summary names failed chapters even when others succeeded', () => {
  expect(
    backfillMessage({
      ...READY,
      chapters: [
        READY.chapters[0],
        {
          path: '正文/第009章.md',
          ordinal: null,
          status: 'failed',
          added: 0,
          unverified: 0,
          conflicts: [],
          message: '超时',
        },
      ],
    }),
  ).toBe('补录 1 章，记下 5 条事实；「第009章.md」没抽成（超时）。');
});

test('在甲书补着时切到乙书：乙书看不到甲书的进度、也能自己开补录；甲书补完的通知带上书名', async () => {
  const A = '/books/甲书';
  const B = '/books/乙书';
  let latest!: ReturnType<typeof useObservatory>;
  function Switchable({ project }: { project: string }) {
    latest = useObservatory({ activeProject: project, dialogs });
    return null;
  }
  vi.mocked(listUnrecordedChapters).mockImplementation(async (projectRoot) =>
    projectRoot === A ? chapters(1) : chapters(2),
  );
  let releaseA!: () => void;
  vi.mocked(prepareFactBackfill).mockImplementation(async (input, onProgress) => {
    onProgress?.(0, input.paths.length, input.paths[0]);
    if (input.projectRoot === A)
      await new Promise<void>((resolve) => {
        releaseA = resolve;
      });
    return { status: 'unchanged', added: 0, chapters: [] };
  });

  await act(async () => root.render(<Switchable project={A} />));
  await act(async () => {});
  let runningA!: Promise<void>;
  await act(async () => {
    runningA = latest.factBackfill.start();
    await Promise.resolve();
  });
  expect(latest.factBackfill.progress).not.toBeNull();

  await act(async () => root.render(<Switchable project={B} />));
  await act(async () => {});
  expect(latest.factBackfill.progress).toBeNull();
  expect(latest.factBackfill.unrecorded).toHaveLength(2);
  await act(async () => latest.factBackfill.start());
  expect(vi.mocked(prepareFactBackfill).mock.calls.map(([input]) => input.projectRoot)).toEqual([
    A,
    B,
  ]);

  await act(async () => {
    releaseA();
    await runningA;
  });
  expect(latest.factBackfill.progress).toBeNull();
  expect(toasts.at(-1)?.message).toMatch(/^「甲书」/);
});

test('切到乙书、扫描已回来但候选章还没读出（全项目审计 E-18）：不拿甲书的章去给乙书补录', async () => {
  const A = '/books/甲书';
  const B = '/books/乙书';
  let latest!: ReturnType<typeof useObservatory>;
  function Switchable({ project }: { project: string }) {
    latest = useObservatory({ activeProject: project, dialogs });
    return null;
  }
  let releaseB!: () => void;
  const onlyB = [{ path: '正文/第002章.md', ordinal: 2 }];
  vi.mocked(listUnrecordedChapters).mockImplementation(async (projectRoot) => {
    if (projectRoot === A) return chapters(1);
    await new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    return onlyB;
  });
  vi.mocked(prepareFactBackfill).mockResolvedValue({ status: 'unchanged', added: 0, chapters: [] });

  await act(async () => root.render(<Switchable project={A} />));
  await act(async () => {});
  expect(latest.factBackfill.unrecorded).toEqual(chapters(1));

  await act(async () => root.render(<Switchable project={B} />));
  await act(async () => {});
  expect(latest.availability).toBe('available');
  expect(latest.factBackfill.unrecorded).toEqual([]);
  await act(async () => latest.factBackfill.start());
  expect(vi.mocked(prepareFactBackfill)).not.toHaveBeenCalled();

  await act(async () => releaseB());
  await act(async () => {});
  expect(latest.factBackfill.unrecorded).toEqual(onlyB);
  await act(async () => latest.factBackfill.start());
  expect(
    vi.mocked(prepareFactBackfill).mock.calls.map(([input]) => [input.projectRoot, input.paths]),
  ).toEqual([[B, ['正文/第002章.md']]]);
});
