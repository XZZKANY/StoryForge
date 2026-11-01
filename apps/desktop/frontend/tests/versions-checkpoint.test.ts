import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

type MemFile = { content: string };
const disk = new Map<string, MemFile>();
let existsThrows = false;
let metaWriteError: Error | null = null;
const events: string[] = [];

const shadow = vi.hoisted(() => ({
  createError: null as Error | null,
  retainError: null as Error | null,
  filterError: null as Error | null,
  nextTreeHash: 'a'.repeat(40),
  retainedHashes: new Set<string>(),
  releasedRecordIds: [] as string[],
  treeFiles: new Map<string, Map<string, { exists: boolean; content: string }>>(),
}));

function normalize(path: string): string {
  return path.replace(/\\/g, '/');
}

vi.mock('../src/lib/host/tauri-fs', () => ({
  TauriFileSystem: {
    writeFile: async (_root: string, path: string, content: string) => {
      events.push(path.endsWith('.meta.json') ? 'write-meta' : 'write-file');
      if (path.endsWith('.meta.json') && metaWriteError) throw metaWriteError;
      disk.set(normalize(path), { content });
    },
    readProjectFile: async (root: string, path: string) => {
      if (!normalize(path).startsWith(`${normalize(root)}/`)) throw new Error(`作品外: ${path}`);
      const file = disk.get(normalize(path));
      if (!file) throw new Error(`不存在: ${path}`);
      return file.content;
    },
    listProjectDir: async (root: string, dir: string) => {
      const prefix = `${normalize(dir)}/`;
      if (!prefix.startsWith(`${normalize(root)}/`)) throw new Error(`作品外: ${dir}`);
      const seen = new Map<string, { name: string; path: string; isDir: boolean }>();
      for (const key of disk.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        seen.set(name, { name, path: `${prefix}${name}`, isDir: slash !== -1 });
      }
      if (!seen.size) throw new Error(`目录不存在: ${dir}`);
      return [...seen.values()];
    },
    projectPathExists: async (root: string, path: string) => {
      if (existsThrows) throw new Error('探测失败');
      if (!`${normalize(path)}/`.startsWith(`${normalize(root)}/`)) throw new Error(`作品外: ${path}`);
      return disk.has(normalize(path));
    },
    deletePath: async (_root: string, path: string) => {
      events.push('delete-meta');
      disk.delete(normalize(path));
    },
  },
}));

vi.mock('../src/lib/host/shadow-git', () => ({
  createShadowSnapshot: async () => {
    events.push('create-tree');
    if (shadow.createError) throw shadow.createError;
    return { treeHash: shadow.nextTreeHash, gitVersion: 'git version 2.55.0.windows.3' };
  },
  retainShadowSnapshot: async (_project: string, treeHash: string) => {
    events.push('retain-ref');
    if (shadow.retainError) throw shadow.retainError;
    shadow.retainedHashes.add(treeHash);
  },
  releaseShadowSnapshot: async (_project: string, recordId: string) => {
    events.push('release-ref');
    shadow.releasedRecordIds.push(recordId);
  },
  filterShadowSnapshotHashes: async (_project: string, hashes: string[]) => {
    if (shadow.filterError) throw shadow.filterError;
    return hashes.filter((hash) => shadow.retainedHashes.has(hash));
  },
  readShadowSnapshotFile: async (_project: string, treeHash: string, file: string) =>
    shadow.treeFiles.get(treeHash)?.get(normalize(file)) ?? { exists: false, content: '' },
}));

import {
  listVersions,
  readVersionState,
  snapshotBeforeDelete,
  recordRenameLineage,
  snapshotBeforeWrite,
} from '../src/lib/versions';

const PROJECT = 'D:/连载/末世吞噬';
const FILE = 'D:/连载/末世吞噬/正文/第01章.md';
const VERSION_DIR = 'D:/连载/末世吞噬/.storyforge/versions/正文/第01章.md';

let clock = 1_700_000_000_000;

beforeEach(() => {
  disk.clear();
  events.length = 0;
  existsThrows = false;
  metaWriteError = null;
  shadow.createError = null;
  shadow.retainError = null;
  shadow.filterError = null;
  shadow.nextTreeHash = 'a'.repeat(40);
  shadow.retainedHashes.clear();
  shadow.releasedRecordIds.length = 0;
  shadow.treeFiles.clear();
  clock += 100_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function directMetaPaths(sub = ''): string[] {
  const prefix = `${VERSION_DIR}${sub}/`;
  return [...disk.keys()].filter(
    (key) =>
      key.startsWith(prefix) &&
      key.endsWith('.meta.json') &&
      !key.slice(prefix.length).includes('/'),
  );
}

test('new snapshots write only v2 metadata and retain the tree before returning', async () => {
  disk.set(normalize(FILE), { content: '旧' });
  const result = await snapshotBeforeWrite(PROJECT, FILE, '旧', {
    source: 'Agent',
    summary: '修订第一章开场',
    patchId: 'patch-7',
    assistantSessionId: 42,
    issueIds: ['issue-1', 'issue-2'],
    contextFiles: ['正文/第02章.md'],
    parentId: 1700000000000,
    branchId: 'branch-rain',
    branchLabel: '雨夜支线',
    checkpoint: true,
    runId: 'run-7',
  });

  assert.deepEqual(events, ['create-tree', 'write-meta', 'retain-ref']);
  assert.equal(directMetaPaths('/checkpoints').length, 1);
  assert.equal(
    [...disk.keys()].some((path) => path.endsWith('.snapshot.md')),
    false,
  );
  const stored = JSON.parse(disk.get(normalize(result!.path))!.content) as Record<string, unknown>;
  assert.equal(stored.schemaVersion, 2);
  assert.equal(stored.storage, 'shadow-git');
  assert.equal(stored.treeHash, 'a'.repeat(40));
  assert.equal(stored.source, 'Agent');
  assert.equal(stored.summary, '修订第一章开场');
  assert.equal(stored.file, '正文/第01章.md');
  assert.equal(stored.patchId, 'patch-7');
  assert.equal(stored.assistantSessionId, 42);
  assert.deepEqual(stored.issueIds, ['issue-1', 'issue-2']);
  assert.deepEqual(stored.contextFiles, ['正文/第02章.md']);
  assert.equal(stored.parentId, 1700000000000);
  assert.equal(stored.branchId, 'branch-rain');
  assert.equal(stored.branchLabel, '雨夜支线');
  assert.equal(stored.runId, 'run-7');
  assert.equal(stored.created, false);
  assert.equal(typeof stored.recordId, 'string');
  assert.equal('content' in stored, false, 'v2 metadata must not duplicate manuscript content');
});

test('new lightweight records are not truncated after twenty versions', async () => {
  disk.set(normalize(FILE), { content: '旧' });
  for (let index = 0; index < 25; index += 1) {
    shadow.nextTreeHash = index.toString(16).padStart(40, '0');
    await snapshotBeforeWrite(PROJECT, FILE, `第 ${index} 版`, { source: 'Editor' });
  }
  assert.equal(directMetaPaths().length, 25);
  assert.equal((await listVersions(PROJECT, FILE)).length, 25);
});

test('created metadata still distinguishes a missing file from an existing empty file', async () => {
  const created = await snapshotBeforeWrite(PROJECT, FILE, '', { source: 'Agent' });
  assert.equal(created?.created, true);

  disk.set(normalize(FILE), { content: '' });
  const existing = await snapshotBeforeWrite(PROJECT, FILE, '', { source: 'Agent' });
  assert.equal(existing?.created, false);
});

test('existence probe failure remains conservative and never marks the file for deletion', async () => {
  existsThrows = true;
  const result = await snapshotBeforeWrite(PROJECT, FILE, '', { source: 'Agent' });
  assert.equal(result?.created, false);
});

test('tree, metadata, or retain failures reject and remove half-written metadata', async () => {
  shadow.createError = new Error('missing bundled Git');
  await assert.rejects(snapshotBeforeWrite(PROJECT, FILE, '旧'), /missing bundled Git/);
  assert.equal(directMetaPaths().length, 0);
  assert.deepEqual(events, ['create-tree']);

  events.length = 0;
  shadow.createError = null;
  metaWriteError = new Error('metadata disk full');
  await assert.rejects(snapshotBeforeWrite(PROJECT, FILE, '旧'), /metadata disk full/);
  assert.equal(directMetaPaths().length, 0);
  assert.deepEqual(events, ['create-tree', 'write-meta', 'release-ref', 'delete-meta']);
  assert.equal(events.includes('retain-ref'), false);

  events.length = 0;
  metaWriteError = null;
  shadow.retainError = new Error('update-ref failed');
  await assert.rejects(snapshotBeforeWrite(PROJECT, FILE, '旧'), /update-ref failed/);
  assert.equal(directMetaPaths().length, 0);
  assert.equal(events[0], 'create-tree');
  assert.equal(events[1], 'write-meta');
  assert.equal(events[2], 'retain-ref');
  assert.equal(events.includes('delete-meta'), true);
  assert.equal(events.includes('release-ref'), true);
});

test('legacy and v2 entries share one timeline and one structured reader', async () => {
  const legacyStamp = clock + 1;
  const treeStamp = clock + 2;
  const treeHash = 'b'.repeat(40);
  const legacyPath = `${VERSION_DIR}/${legacyStamp}.snapshot.md`;
  disk.set(legacyPath, { content: '旧式正文' });
  disk.set(`${VERSION_DIR}/${legacyStamp}.meta.json`, {
    content: JSON.stringify({ source: 'Editor', file: '正文/第01章.md' }),
  });
  disk.set(`${VERSION_DIR}/checkpoints/${treeStamp}.meta.json`, {
    content: JSON.stringify({
      schemaVersion: 2,
      storage: 'shadow-git',
      treeHash,
      recordId: 'record_002',
      source: 'Agent',
      file: '正文/第01章.md',
      runId: 'run-2',
    }),
  });
  shadow.retainedHashes.add(treeHash);
  shadow.treeFiles.set(
    treeHash,
    new Map([['正文/第01章.md', { exists: true, content: 'tree 正文' }]]),
  );

  const versions = await listVersions(PROJECT, FILE);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].contentRef.kind, 'shadow-tree');
  assert.equal(versions[0].checkpoint, true);
  assert.equal(versions[0].runId, 'run-2');
  assert.equal(versions[1].contentRef.kind, 'legacy-file');
  assert.deepEqual(await readVersionState(PROJECT, versions[0]), {
    exists: true,
    content: 'tree 正文',
  });
  assert.deepEqual(await readVersionState(PROJECT, versions[1]), {
    exists: true,
    content: '旧式正文',
  });
});

test('legacy created snapshots restore as missing instead of an empty file', async () => {
  const stamp = clock + 1;
  disk.set(`${VERSION_DIR}/${stamp}.snapshot.md`, { content: '' });
  disk.set(`${VERSION_DIR}/${stamp}.meta.json`, {
    content: JSON.stringify({ created: true, file: '正文/第01章.md' }),
  });
  const [entry] = await listVersions(PROJECT, FILE);
  assert.deepEqual(await readVersionState(PROJECT, entry), { exists: false, content: '' });
});

test('v2 metadata with a missing ref remains visible but cannot be restored', async () => {
  const stamp = clock + 1;
  const treeHash = 'c'.repeat(40);
  disk.set(`${VERSION_DIR}/${stamp}.meta.json`, {
    content: JSON.stringify({
      schemaVersion: 2,
      storage: 'shadow-git',
      treeHash,
      recordId: 'record_003',
      file: '正文/第01章.md',
    }),
  });
  const [entry] = await listVersions(PROJECT, FILE);
  assert.match(entry.unavailableReason ?? '', /保活 ref/);
  await assert.rejects(readVersionState(PROJECT, entry), /保活 ref/);
});

test('shadow repository failure keeps metadata visible and leaves legacy versions readable', async () => {
  const legacyStamp = clock + 1;
  const treeStamp = clock + 2;
  disk.set(`${VERSION_DIR}/${legacyStamp}.snapshot.md`, { content: '旧式正文' });
  disk.set(`${VERSION_DIR}/${treeStamp}.meta.json`, {
    content: JSON.stringify({
      schemaVersion: 2,
      storage: 'shadow-git',
      treeHash: 'd'.repeat(40),
      recordId: 'record_004',
      file: '正文/第01章.md',
    }),
  });
  shadow.filterError = new Error('shadow repository missing');

  const versions = await listVersions(PROJECT, FILE);

  assert.equal(versions.length, 2);
  const treeEntry = versions.find((entry) => entry.contentRef.kind === 'shadow-tree');
  const legacyEntry = versions.find((entry) => entry.contentRef.kind === 'legacy-file');
  assert.match(treeEntry?.unavailableReason ?? '', /shadow repository missing/);
  assert.equal(legacyEntry?.unavailableReason, undefined);
  assert.deepEqual(await readVersionState(PROJECT, legacyEntry!), {
    exists: true,
    content: '旧式正文',
  });
});

test('删除前快照：整本书只拍一次影子树，要删的每个文件各记一条能列出来的版本', async () => {
  const other = 'D:/连载/末世吞噬/正文/第02章.md';
  disk.set(normalize(FILE), { content: '第一章' });
  disk.set(normalize(other), { content: '第二章' });

  await snapshotBeforeDelete(PROJECT, [FILE, other]);

  assert.equal(events.filter((event) => event === 'create-tree').length, 1);
  assert.equal(events.filter((event) => event === 'retain-ref').length, 2);
  for (const file of [FILE, other]) {
    const versions = await listVersions(PROJECT, file);
    assert.equal(versions.length, 1);
    assert.equal(versions[0]?.summary, '删除前快照');
    assert.equal(versions[0]?.unavailableReason, undefined);
  }
});

test('改名后版本记录跟着走：新名字下列得出旧名字时的版本，内容按当时的路径从影子树取', async () => {
  const renamed = 'D:/连载/末世吞噬/正文/第01章 夜探.md';
  disk.set(normalize(FILE), { content: '改名前' });
  shadow.nextTreeHash = 'c'.repeat(40);
  shadow.treeFiles.set(
    'c'.repeat(40),
    new Map([['正文/第01章.md', { exists: true, content: '改名前' }]]),
  );
  await snapshotBeforeWrite(PROJECT, FILE, '改名前', { summary: '手动保存前快照' });

  await recordRenameLineage(PROJECT, [{ from: FILE, to: renamed }]);

  const versions = await listVersions(PROJECT, renamed);
  assert.equal(versions.length, 1);
  assert.equal(versions[0]?.unavailableReason, undefined);
  assert.deepEqual(await readVersionState(PROJECT, versions[0]!), {
    exists: true,
    content: '改名前',
  });
});

test('连改两次名：最新名字下前两个名字的版本都在', async () => {
  const second = 'D:/连载/末世吞噬/正文/第01章 改.md';
  const third = 'D:/连载/末世吞噬/正文/第01章 再改.md';
  disk.set(normalize(FILE), { content: '一' });
  await snapshotBeforeWrite(PROJECT, FILE, '一');
  await recordRenameLineage(PROJECT, [{ from: FILE, to: second }]);
  disk.set(normalize(second), { content: '二' });
  await snapshotBeforeWrite(PROJECT, second, '二');
  await recordRenameLineage(PROJECT, [{ from: second, to: third }]);

  const files = (await listVersions(PROJECT, third)).map((entry) => entry.file);
  assert.deepEqual(files.sort(), ['正文/第01章 改.md', '正文/第01章.md']);
});

test('写入前文件在、快照却把它排除了（过大或被忽略）：这个版本不能当成「不存在」去恢复', async () => {
  const stamp = clock + 1;
  const treeHash = 'd'.repeat(40);
  const meta = (created: boolean) =>
    JSON.stringify({
      schemaVersion: 2,
      storage: 'shadow-git',
      treeHash,
      recordId: `record_${created ? 'new' : 'old'}`,
      file: '正文/第01章.md',
      created,
    });
  disk.set(`${VERSION_DIR}/${stamp}.meta.json`, { content: meta(false) });
  disk.set(`${VERSION_DIR}/${stamp + 1}.meta.json`, { content: meta(true) });
  shadow.retainedHashes.add(treeHash);
  shadow.treeFiles.set(treeHash, new Map());

  const versions = await listVersions(PROJECT, FILE);
  const existed = versions.find((entry) => entry.created === false)!;
  const fresh = versions.find((entry) => entry.created === true)!;
  await assert.rejects(readVersionState(PROJECT, existed), /没有存下这份文件的内容/);
  // 真正新建的文件：写入前本来就不存在，恢复成「不存在」照旧。
  assert.deepEqual(await readVersionState(PROJECT, fresh), { exists: false, content: '' });
});
