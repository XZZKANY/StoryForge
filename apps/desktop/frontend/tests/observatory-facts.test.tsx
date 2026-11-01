/**
 * 观测镜「事实台账」分区接在真实的 useObservatory 上：按章列出、最近的章展开，
 * 点一条跳原文，作废写 facts.json（写前快照、可撤销），没有台账或台账坏了如实说。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useObservatory } from '../src/components/app/useObservatory';
import { ObservatoryView } from '../src/components/shell/ObservatoryView';
import { resolveLedgerDispute, retireLedgerFact } from '../src/lib/api/facts';
import { executeIdeCommand } from '../src/lib/api/ide-commands';
import { factsLedgerPathFor } from '../src/lib/fact-write';
import { mapObservatoryPayload, type ObservationAnchor } from '../src/lib/observations';
import { invalidateFileSystemCache } from '../src/lib/host/tauri-fs';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';
import { snapshotBeforeWrite } from '../src/lib/versions';

vi.mock('../src/lib/api/ide-commands', () => ({ executeIdeCommand: vi.fn() }));
vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: vi.fn(async () => null) }));
vi.mock('../src/lib/api/facts', () => ({
  BACKFILL_BATCH: 20,
  retireLedgerFact: vi.fn(),
  resolveLedgerDispute: vi.fn(),
  listUnrecordedChapters: vi.fn(async () => []),
  prepareFactBackfill: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = '/books/facts';
const PATH = factsLedgerPathFor(PROJECT);
const LEDGER = '{"version": 1, "facts": ["…"]}\n';
const RETIRED = '{"version": 1, "facts": ["retired"]}\n';
const FACT = (id: string, value: string, valid = true) => ({
  id,
  kind: '处境',
  subject: '陈默',
  attribute: '下落',
  value,
  object: null,
  quote: `陈默${value}。`,
  line: 3,
  valid,
});
const FACTS = {
  active: 3,
  stale: 1,
  superseded: 2,
  retired: 0,
  chapters: [
    {
      path: '正文/第002章.md',
      ordinal: 2,
      facts: [FACT('c', '在城里'), FACT('d', '有钥匙', false)],
    },
    { path: '正文/第001章.md', ordinal: 1, facts: [FACT('b', '在山里')] },
  ],
};

let disk: Map<string, string>;
let toasts: ToastDetail[];
let located: ObservationAnchor[];
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
      onLocateAnchor={(anchor) => located.push(anchor)}
      onRetireFact={(fact) => void obs.retireFact(fact)}
      onResolveDispute={(dispute, choice) => void obs.resolveDispute(dispute, choice)}
    />
  );
}

const scanWith = (facts: unknown) =>
  vi.mocked(executeIdeCommand).mockResolvedValue({
    command_id: 'observatory.scan',
    status: 'accepted',
    payload: { observatory: { generated_at: '2026-10-18T00:00:00Z', ...(facts ? { facts } : {}) } },
  } as never);
const mount = async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => {});
};
const section = () => container.querySelector('[data-testid="obs-section-facts"]')!;
const all = (testid: string) => [
  ...container.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`),
];
const click = (element: HTMLElement | undefined) =>
  act(async () => {
    element!.click();
  });

beforeEach(() => {
  disk = new Map([[PATH, LEDGER]]);
  toasts = [];
  located = [];
  window.addEventListener(TOAST_EVENT, onToast);
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => disk.has(path),
    readFile: (path) => disk.get(path) ?? '',
    writeFile: (path, content) => void disk.set(path, content),
  };
  vi.mocked(snapshotBeforeWrite).mockClear();
  vi.mocked(retireLedgerFact).mockReset().mockResolvedValue(RETIRED);
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
});

test('lists facts by chapter with the latest open and lost evidence flagged', async () => {
  scanWith(FACTS);
  await mount();
  expect(section().textContent).toContain('事实台账');
  expect(container.querySelector('[data-testid="obs-facts-summary"]')?.textContent).toBe(
    '有效 3 条，来自 2 章；1 条依据已失效，起草不再带，2 条已被新状态替代。点一条看原文。',
  );
  const toggles = all('obs-fact-chapter-toggle');
  expect(toggles.map((item) => item.textContent)).toEqual([
    '第 2 章 · 2 条（1 条依据已失效）',
    '第 1 章 · 1 条',
  ]);
  expect(all('obs-fact').map((item) => item.textContent)).toEqual([
    '陈默 · 处境/下落：在城里作废',
    '陈默 · 处境/下落：有钥匙依据已失效作废',
  ]);
  await click(toggles[1]);
  expect(all('obs-fact')).toHaveLength(3);
});

test('clicking a fact jumps to its sentence in the chapter', async () => {
  scanWith(FACTS);
  await mount();
  await click(all('obs-fact-locate')[0]);
  expect(located).toEqual([{ path: '正文/第002章.md', line: 3, snippet: '陈默在城里。' }]);
});

test('retiring writes facts.json after a snapshot, and the toast undoes it', async () => {
  scanWith(FACTS);
  await mount();
  await click(all('obs-fact-retire')[1]);
  expect(retireLedgerFact).toHaveBeenCalledWith(LEDGER, 'd');
  expect(snapshotBeforeWrite).toHaveBeenCalledWith(PROJECT, PATH, LEDGER, {
    source: 'Editor',
    summary: '事实台账作废：陈默 · 处境/下落：有钥匙',
    checkpoint: true,
  });
  expect(disk.get(PATH)).toBe(RETIRED);
  const toast = toasts.at(-1)!;
  expect(toast.message).toBe('已作废：陈默 · 处境/下落：有钥匙。起草不再带它。');
  await act(async () => {
    await toast.action!.run();
  });
  expect(disk.get(PATH)).toBe(LEDGER);
});

test('a ledger changed meanwhile is left alone', async () => {
  scanWith(FACTS);
  await mount();
  vi.mocked(retireLedgerFact).mockImplementation(async () => {
    disk.set(PATH, 'hand edit');
    return RETIRED;
  });
  await click(all('obs-fact-retire')[0]);
  expect(disk.get(PATH)).toBe('hand edit');
  expect(snapshotBeforeWrite).not.toHaveBeenCalled();
  expect(toasts.at(-1)).toMatchObject({
    tone: 'error',
    message: expect.stringContaining('没有作废'),
  });
});

test('says plainly when there is no ledger yet, or when it is broken', async () => {
  scanWith(null);
  await mount();
  expect(section().textContent).toContain('还没有事实台账');
  expect(all('obs-fact')).toHaveLength(0);

  scanWith({ error: 'facts.json 的 facts[0].id 应为字符串' });
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount();
  expect(container.querySelector('[data-testid="obs-facts-error"]')?.textContent).toContain(
    'facts[0].id 应为字符串',
  );
});

test('the payload mapper drops malformed facts and empty chapters', () => {
  const mapped = mapObservatoryPayload(
    {
      facts: {
        active: 1,
        stale: -1,
        chapters: [
          { path: '正文/第001章.md', ordinal: 1, facts: [FACT('b', '在山里'), { id: 'x' }, null] },
          { path: '正文/第002章.md', ordinal: 2, facts: [{ subject: '无 id' }] },
          { facts: [FACT('y', '没有路径')] },
        ],
      },
    },
    new Set(),
  );
  expect(mapped.facts).toEqual({
    status: 'ready',
    active: 1,
    stale: 0,
    superseded: 0,
    retired: 0,
    chapters: [{ path: '正文/第001章.md', ordinal: 1, facts: [FACT('b', '在山里')] }],
    disputed: [],
  });
  expect(mapObservatoryPayload({}, new Set()).facts).toEqual({ status: 'none' });
});

const DISPUTE = {
  id: 'x',
  kind: '关系',
  subject: '陈默',
  attribute: '兄弟姐妹',
  value: '有个姐姐',
  quote: '陈默想起了姐姐。',
  line: 5,
  path: '正文/第002章.md',
  ordinal: 2,
  existing: { value: '独子', path: '正文/第001章.md', ordinal: 1, quote: '陈默是独子。' },
};

test('disputed facts sit on top with both versions, and jump to the chapter sentence', async () => {
  scanWith({ ...FACTS, disputed: [DISPUTE, { id: 'broken' }] });
  await mount();
  expect(container.querySelector('[data-testid="obs-facts-summary"]')?.textContent).toContain(
    '1 条对不上等你定',
  );
  const items = all('obs-fact-dispute');
  expect(items).toHaveLength(1);
  expect(all('obs-fact-dispute-locate')[0].textContent).toBe(
    '陈默的兄弟姐妹：第 2 章写「有个姐姐」，已记（第 1 章）「独子」',
  );
  await click(all('obs-fact-dispute-locate')[0]);
  expect(located).toEqual([{ path: '正文/第002章.md', line: 5, snippet: '陈默想起了姐姐。' }]);
});

test.each([
  [
    'accept',
    'obs-fact-dispute-accept',
    '以本章为准：陈默的兄弟姐妹「有个姐姐」，原来记的不再用。',
    '以本章为准',
  ],
  [
    'reject',
    'obs-fact-dispute-reject',
    '保留已记的，不用本章的陈默的兄弟姐妹「有个姐姐」。',
    '保留已记的',
  ],
] as const)(
  'deciding a dispute (%s) writes after a snapshot and can be undone',
  async (choice, testid, toast, summary) => {
    vi.mocked(resolveLedgerDispute).mockReset().mockResolvedValue(RETIRED);
    scanWith({ ...FACTS, disputed: [DISPUTE] });
    await mount();
    await click(all(testid)[0]);
    expect(resolveLedgerDispute).toHaveBeenCalledWith(PROJECT, LEDGER, 'x', choice);
    expect(snapshotBeforeWrite).toHaveBeenCalledWith(PROJECT, PATH, LEDGER, {
      source: 'Editor',
      summary: `事实台账${summary}：陈默的兄弟姐妹「有个姐姐」`,
      checkpoint: true,
    });
    expect(disk.get(PATH)).toBe(RETIRED);
    expect(toasts.at(-1)?.message).toBe(toast);
    await act(async () => {
      await toasts.at(-1)!.action!.run();
    });
    expect(disk.get(PATH)).toBe(LEDGER);
  },
);

test('a ledger changed while deciding a dispute is left alone', async () => {
  vi.mocked(resolveLedgerDispute)
    .mockReset()
    .mockImplementation(async () => {
      disk.set(PATH, 'hand edit');
      return RETIRED;
    });
  scanWith({ ...FACTS, disputed: [DISPUTE] });
  await mount();
  await click(all('obs-fact-dispute-accept')[0]);
  expect(disk.get(PATH)).toBe('hand edit');
  expect(snapshotBeforeWrite).not.toHaveBeenCalled();
  expect(toasts.at(-1)).toMatchObject({
    tone: 'error',
    message: expect.stringContaining('没有写入'),
  });
});
