/**
 * 批量写章撤销时事实台账回到记账前那一版：版本记录按引擎给的作品内相对路径找，
 * 同一套写法——恢复前再拍一版、以读到的那一份为准写；那一版里没有台账就删掉；已经是那一版就不写。
 */
import { beforeEach, expect, test, vi } from 'vitest';

import { factsLedgerPathFor, restoreFactsLedger } from '../src/lib/fact-write';
import { invalidateFileSystemCache, TauriFileSystem } from '../src/lib/host/tauri-fs';
import { listVersions, readVersionState, snapshotBeforeWrite } from '../src/lib/versions';

vi.mock('../src/lib/versions', () => ({
  snapshotBeforeWrite: vi.fn(async () => null),
  listVersions: vi.fn(),
  readVersionState: vi.fn(),
}));

const PROJECT = 'D:\\books\\雾港回声';
const PATH = factsLedgerPathFor(PROJECT);
const META = `${PROJECT}\\.storyforge\\versions\\.storyforge\\canon\\facts.json\\checkpoints\\12.meta.json`;
const REF = '.storyforge/versions/.storyforge/canon/facts.json/checkpoints/12.meta.json';
const BEFORE_BATCH = '{"version":1,"facts":[]}';
const AFTER_BATCH = '{"version":1,"facts":[{"id":"fact_4"},{"id":"fact_5"}]}';

let disk: Map<string, string>;
let order: string[];

beforeEach(() => {
  vi.clearAllMocks();
  invalidateFileSystemCache();
  disk = new Map([[PATH, AFTER_BATCH]]);
  order = [];
  window.__STORYFORGE_MOCK_FS__ = {
    pathExists: (path) => disk.has(path),
    readFile: (path) => {
      const content = disk.get(path);
      if (content === undefined) throw new Error(`missing: ${path}`);
      return content;
    },
    writeFile: (path, content) => {
      order.push(`write:${content}`);
      disk.set(path, content);
    },
  };
  vi.mocked(listVersions).mockResolvedValue([
    {
      path: `${PROJECT}\\.storyforge\\versions\\.storyforge\\canon\\facts.json\\checkpoints\\13.meta.json`,
      contentRef: {
        kind: 'shadow-tree',
        treeHash: 'b'.repeat(40),
        file: '.storyforge/canon/facts.json',
      },
      timestamp: 13,
    },
    {
      path: META,
      contentRef: {
        kind: 'shadow-tree',
        treeHash: 'a'.repeat(40),
        file: '.storyforge/canon/facts.json',
      },
      timestamp: 12,
    },
  ]);
  vi.mocked(readVersionState).mockResolvedValue({ exists: true, content: BEFORE_BATCH });
  vi.mocked(snapshotBeforeWrite).mockImplementation(async () => {
    order.push('snapshot');
    return null;
  });
});

test('找到那条版本记录，先拍一版再写回记账前的台账', async () => {
  await expect(restoreFactsLedger(PROJECT, REF)).resolves.toBe(true);
  expect(listVersions).toHaveBeenCalledWith(PROJECT, PATH);
  expect(vi.mocked(readVersionState).mock.calls[0][1].path).toBe(META);
  expect(order).toEqual(['snapshot', `write:${BEFORE_BATCH}`]);
  expect(snapshotBeforeWrite).toHaveBeenCalledWith(
    PROJECT,
    PATH,
    AFTER_BATCH,
    expect.objectContaining({ checkpoint: true }),
  );
  expect(disk.get(PATH)).toBe(BEFORE_BATCH);
});

test('那一版里还没有台账：删掉台账', async () => {
  vi.mocked(readVersionState).mockResolvedValue({ exists: false, content: '' });
  const deletePath = vi.spyOn(TauriFileSystem, 'deletePath').mockImplementation(async () => {
    order.push('delete');
  });
  await expect(restoreFactsLedger(PROJECT, REF)).resolves.toBe(true);
  expect(order).toEqual(['snapshot', 'delete']);
  expect(deletePath).toHaveBeenCalledWith(PROJECT, PATH);
  deletePath.mockRestore();
});

test('已经是那一版：不拍不写', async () => {
  disk.set(PATH, BEFORE_BATCH);
  await expect(restoreFactsLedger(PROJECT, REF)).resolves.toBe(false);
  expect(order).toEqual([]);
});

test('找不到那条版本记录：明确报错，不写', async () => {
  await expect(
    restoreFactsLedger(
      PROJECT,
      '.storyforge/versions/.storyforge/canon/facts.json/checkpoints/99.meta.json',
    ),
  ).rejects.toThrow('找不到记账前那一版事实台账的版本记录');
  expect(order).toEqual([]);
});

test('拍快照那会儿台账被别处改了：宿主拒写', async () => {
  vi.mocked(snapshotBeforeWrite).mockImplementation(async () => {
    disk.set(PATH, '{"version":1,"facts":[{"id":"作者刚定的"}]}');
    return null;
  });
  await expect(restoreFactsLedger(PROJECT, REF)).rejects.toThrow('磁盘内容已变化');
  expect(disk.get(PATH)).toBe('{"version":1,"facts":[{"id":"作者刚定的"}]}');
});
