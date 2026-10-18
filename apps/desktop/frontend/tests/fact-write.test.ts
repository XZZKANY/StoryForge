/**
 * 事实台账的唯一写入口：引擎算出写什么，这里管写——记账期间文件被改就停、写前必有快照、
 * 撤销只在文件没被别处动过时生效；对不上的事实只在通知里说，不写。
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { prepareChapterFactRecord, type ChapterFactRecordPlan } from '../src/lib/api/facts';
import {
  factRecordMessage,
  factsLedgerPathFor,
  recordAcceptedChapterFacts,
  recordChapterFacts,
} from '../src/lib/fact-write';
import { invalidateFileSystemCache, TauriFileSystem } from '../src/lib/tauri-fs';
import { emitToast } from '../src/lib/toast';
import { snapshotBeforeWrite } from '../src/lib/versions';

vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: vi.fn(async () => null) }));
vi.mock('../src/lib/toast', () => ({ emitToast: vi.fn() }));
vi.mock('../src/lib/api/facts', () => ({ prepareChapterFactRecord: vi.fn() }));

const PROJECT = 'D:\\books\\雾港回声';
const PATH = factsLedgerPathFor(PROJECT);
const CHAPTER = 'D:\\books\\雾港回声\\正文\\第002章.md';
const ORIGINAL = '{\r\n  "version": 1,\r\n  "facts": []\r\n}\r\n';
const AFTER = '{\r\n  "version": 1,\r\n  "facts": [{"id": "fact_1"}]\r\n}\r\n';
const SUMMARY = {
  chapterPath: '正文/第002章.md',
  chapterOrdinal: 2,
  added: 1,
  superseded: 0,
  duplicates: 0,
  unverified: 0,
  conflicts: [],
};
const ready = (before: string | null): ChapterFactRecordPlan => ({
  status: 'ready',
  ...SUMMARY,
  before,
  after: AFTER,
});
const CONFLICT = {
  kind: '关系',
  subject: '陈默',
  attribute: '兄弟姐妹',
  value: '有个姐姐',
  quote: '他想起姐姐。',
  existingValue: '独子',
  existingPath: '正文/第001章.md',
  existingOrdinal: 1,
};

let disk: Map<string, string>;
let writes: string[];
let deletes: string[];

beforeEach(() => {
  disk = new Map([[PATH, ORIGINAL]]);
  writes = [];
  deletes = [];
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => disk.has(path),
    readFile: (path) => {
      const content = disk.get(path);
      if (content === undefined) throw new Error(`missing: ${path}`);
      return content;
    },
    writeFile: (path, content) => {
      writes.push(path);
      disk.set(path, content);
    },
  };
  // 宿主删文件口在替身文件系统里没有，单独替掉。
  vi.spyOn(TauriFileSystem, 'deletePath').mockImplementation(async (_root, path) => {
    deletes.push(path);
    disk.delete(path);
  });
  vi.mocked(snapshotBeforeWrite).mockClear().mockResolvedValue(null);
  vi.mocked(emitToast).mockClear();
  vi.mocked(prepareChapterFactRecord).mockReset();
});

afterEach(() => {
  delete window.__STORYFORGE_MOCK_FS__;
  invalidateFileSystemCache();
  vi.restoreAllMocks();
});

const record = () =>
  recordChapterFacts({ projectPath: PROJECT, filePath: CHAPTER, runId: 'run-7' });

test('台账路径在项目根下的 .storyforge/canon/facts.json', () => {
  expect(PATH).toBe('D:\\books\\雾港回声\\.storyforge\\canon\\facts.json');
  expect(factsLedgerPathFor('/books/x/')).toBe('/books/x/.storyforge/canon/facts.json');
});

test('把读到的原文交给引擎；先存快照再写，撤销按字节还回去', async () => {
  vi.mocked(prepareChapterFactRecord).mockResolvedValue(ready(ORIGINAL));
  const order: string[] = [];
  vi.mocked(snapshotBeforeWrite).mockImplementation(async (_project, path, previous, meta) => {
    order.push(`snapshot:${path}`);
    expect(previous).toBe(ORIGINAL);
    expect(meta).toMatchObject({ source: 'Editor', summary: '事实台账记下第 2 章的 1 条事实' });
    return null;
  });
  const outcome = await record();
  expect(prepareChapterFactRecord).toHaveBeenCalledWith({
    projectRoot: PROJECT,
    filePath: CHAPTER,
    runId: 'run-7',
    ledgerText: ORIGINAL,
  });
  order.push(...writes.map((path) => `write:${path}`));
  expect(order).toEqual([`snapshot:${PATH}`, `write:${PATH}`]);
  expect(disk.get(PATH)).toBe(AFTER);
  expect(outcome.status).toBe('written');
  if (outcome.status !== 'written') return;
  await outcome.undo();
  expect(disk.get(PATH)).toBe(ORIGINAL);
});

test('原来没有台账：撤销就把新建的文件删掉', async () => {
  disk.clear();
  vi.mocked(prepareChapterFactRecord).mockResolvedValue(ready(null));
  const outcome = await record();
  expect(vi.mocked(prepareChapterFactRecord).mock.calls[0][0].ledgerText).toBeNull();
  expect(vi.mocked(snapshotBeforeWrite).mock.calls[0][2]).toBe('');
  if (outcome.status !== 'written') throw new Error(outcome.status);
  await outcome.undo();
  expect(deletes).toEqual([PATH]);
  expect(disk.has(PATH)).toBe(false);
});

test('记账期间 facts.json 被改过：不拍快照、不写', async () => {
  vi.mocked(prepareChapterFactRecord).mockImplementation(async () => {
    disk.set(PATH, '{"version": 1, "facts": [], "hand": true}');
    return ready(ORIGINAL);
  });
  await expect(record()).rejects.toThrow('facts.json 在记账期间被改过了');
  expect(snapshotBeforeWrite).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});

test('撤销前文件又被改过：不动它', async () => {
  vi.mocked(prepareChapterFactRecord).mockResolvedValue(ready(ORIGINAL));
  const outcome = await record();
  if (outcome.status !== 'written') throw new Error(outcome.status);
  disk.set(PATH, 'later edit');
  await expect(outcome.undo()).rejects.toThrow('之后又改过');
  expect(disk.get(PATH)).toBe('later edit');
});

test.each([
  [{ status: 'skipped', reason: 'no_facts' }, 'skipped'],
  [{ status: 'unchanged', ...SUMMARY, added: 0, duplicates: 3 }, 'unchanged'],
] as const)('没有要写的：不拍快照、不写 %#', async (plan, status) => {
  vi.mocked(prepareChapterFactRecord).mockResolvedValue(plan as ChapterFactRecordPlan);
  expect((await record()).status).toBe(status);
  expect(snapshotBeforeWrite).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});

test('给作者的一句话：记了多少、哪条对不上、哪些原句找不到；什么都没有就不说', () => {
  const plan = ready(ORIGINAL) as Exclude<ChapterFactRecordPlan, { status: 'skipped' }>;
  expect(factRecordMessage(plan)).toBe('第 2 章记下 1 条事实。');
  expect(factRecordMessage({ ...plan, conflicts: [CONFLICT, CONFLICT], unverified: 2 })).toBe(
    '第 2 章记下 1 条事实；和已记的事实对不上，没记：陈默的兄弟姐妹，本章「有个姐姐」，第 1 章「独子」 等 2 条；2 条在接受后的正文里找不到原句，没记。',
  );
  const unchanged = { status: 'unchanged' as const, ...SUMMARY, added: 0 };
  expect(factRecordMessage(unchanged)).toBeNull();
  expect(factRecordMessage({ ...unchanged, chapterOrdinal: null, conflicts: [CONFLICT] })).toBe(
    '「第002章.md」没有新事实要记；和已记的事实对不上，没记：陈默的兄弟姐妹，本章「有个姐姐」，第 1 章「独子」。',
  );
});

test('接受后记账：通知带「撤销记账」，点了就撤', async () => {
  vi.mocked(prepareChapterFactRecord).mockResolvedValue(ready(ORIGINAL));
  await recordAcceptedChapterFacts(PROJECT, CHAPTER, 'run-7');
  expect(emitToast).toHaveBeenCalledOnce();
  const [message, options] = vi.mocked(emitToast).mock.calls[0];
  expect(message).toBe('第 2 章记下 1 条事实。');
  expect(options?.action?.label).toBe('撤销记账');
  await options!.action!.run();
  expect(disk.get(PATH)).toBe(ORIGINAL);
  expect(vi.mocked(emitToast).mock.calls[1]).toEqual(['已撤销这次记账。', { tone: 'success' }]);
});

test('没有运行 id 就不记；记账失败只提示，不往外抛', async () => {
  await recordAcceptedChapterFacts(PROJECT, CHAPTER, undefined);
  await recordAcceptedChapterFacts(null, CHAPTER, 'run-7');
  expect(prepareChapterFactRecord).not.toHaveBeenCalled();

  vi.mocked(prepareChapterFactRecord).mockRejectedValue(
    new Error('facts.json 的 facts[0].id 应为字符串'),
  );
  await expect(recordAcceptedChapterFacts(PROJECT, CHAPTER, 'run-7')).resolves.toBeUndefined();
  expect(emitToast).toHaveBeenCalledWith('这章的事实没记上：facts.json 的 facts[0].id 应为字符串', {
    tone: 'error',
  });
});
