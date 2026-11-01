/**
 * 观测镜写 canon.json 的唯一入口：没改动不打扰、没确认不写、写前必有快照、
 * 确认期间文件被改就停、撤销只在文件没被别处动过时生效。
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { applyCanonMerge, canonDeclarationPathFor } from '../src/lib/canon-merge';
import { writeCanonGuarded } from '../src/lib/canon-write';
import { invalidateFileSystemCache, TauriFileSystem } from '../src/lib/host/tauri-fs';
import { snapshotBeforeWrite } from '../src/lib/versions';

vi.mock('../src/lib/versions', () => ({ snapshotBeforeWrite: vi.fn(async () => null) }));

const PROJECT = '/books/雾港回声';
const PATH = canonDeclarationPathFor(PROJECT);
const ORIGINAL = `${JSON.stringify({ version: 1, entities: [{ id: 'char_lin' }] }, null, 3)}\r\n`;
const RADIO = { kind: 'entity' as const, entity: { id: 'ent_radio', canonical_name: '旧电台' } };

let disk: Map<string, string>;
let writes: string[];

beforeEach(() => {
  disk = new Map([[PATH, ORIGINAL]]);
  writes = [];
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
  vi.mocked(snapshotBeforeWrite).mockClear().mockResolvedValue(null);
});

afterEach(() => {
  delete window.__STORYFORGE_MOCK_FS__;
  invalidateFileSystemCache();
  vi.restoreAllMocks();
});

const merge = (confirm: () => Promise<boolean> = async () => true) =>
  writeCanonGuarded({
    projectPath: PROJECT,
    edit: (canon) => applyCanonMerge(canon, RADIO),
    confirm,
    summary: '并入设定：新实体「旧电台」',
  });

test('确认后先存快照再写，撤销把原文按字节还回去', async () => {
  const order: string[] = [];
  vi.mocked(snapshotBeforeWrite).mockImplementation(async (_project, path, previous, meta) => {
    order.push(`snapshot:${path}`);
    expect(previous).toBe(ORIGINAL);
    expect(meta).toMatchObject({ source: 'Editor', summary: '并入设定：新实体「旧电台」' });
    return null;
  });
  const result = await merge();
  order.push(...writes.map((path) => `write:${path}`));
  expect(order).toEqual([`snapshot:${PATH}`, `write:${PATH}`]);
  expect(JSON.parse(disk.get(PATH)!).entities).toHaveLength(2);

  expect(result.status).toBe('written');
  if (result.status !== 'written') return;
  await result.undo();
  expect(disk.get(PATH)).toBe(ORIGINAL);
});

test('已经有这一条：不问、不拍快照、不写', async () => {
  disk.set(PATH, JSON.stringify({ version: 1, entities: [RADIO.entity] }));
  const confirm = vi.fn(async () => true);
  expect((await merge(confirm)).status).toBe('unchanged');
  expect(confirm).not.toHaveBeenCalled();
  expect(snapshotBeforeWrite).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});

test('作者取消：不拍快照、不写', async () => {
  expect((await merge(async () => false)).status).toBe('cancelled');
  expect(snapshotBeforeWrite).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});

test('确认期间 canon.json 被改过：停手，不覆盖新内容', async () => {
  const edited = JSON.stringify({ version: 1, entities: [{ id: 'char_new' }] });
  await expect(
    merge(async () => {
      disk.set(PATH, edited);
      return true;
    }),
  ).rejects.toThrow(/确认期间被改过.*没有写入/);
  expect(writes).toEqual([]);
  expect(disk.get(PATH)).toBe(edited);
});

test('等快照期间 canon.json 被改过：宿主拒写，后来的内容留着', async () => {
  const later = JSON.stringify({
    version: 1,
    entities: [{ id: 'char_written_while_snapshotting' }],
  });
  vi.mocked(snapshotBeforeWrite).mockImplementation(async () => {
    disk.set(PATH, later);
    return null;
  });
  await expect(merge()).rejects.toThrow('磁盘内容已变化');
  expect(disk.get(PATH)).toBe(later);
});

test('快照失败就不写', async () => {
  vi.mocked(snapshotBeforeWrite).mockRejectedValue(new Error('影子仓坏了'));
  await expect(merge()).rejects.toThrow('影子仓坏了');
  expect(writes).toEqual([]);
  expect(disk.get(PATH)).toBe(ORIGINAL);
});

test('写完之后又被改过：撤销不覆盖，指向版本记录', async () => {
  const result = await merge();
  if (result.status !== 'written') throw new Error('expected written');
  disk.set(PATH, '{"version":1}');
  await expect(result.undo()).rejects.toThrow(/之后又改过.*版本记录/);
  expect(disk.get(PATH)).toBe('{"version":1}');
});

test('原本没有 canon.json：写出新文件，撤销就删掉它', async () => {
  disk.clear();
  const removed: string[] = [];
  vi.spyOn(TauriFileSystem, 'deletePath').mockImplementation(async (_project, path) => {
    removed.push(path);
    disk.delete(path);
  });
  const result = await merge();
  expect(JSON.parse(disk.get(PATH)!)).toMatchObject({ entities: [RADIO.entity] });
  if (result.status !== 'written') throw new Error('expected written');
  await result.undo();
  expect(removed).toEqual([PATH]);
  expect(disk.has(PATH)).toBe(false);
});
