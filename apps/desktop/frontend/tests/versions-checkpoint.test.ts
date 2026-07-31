/**
 * 版本安全网：检查点独立配额 + 「新建」与「内容为空」的区分。
 *
 * 自动档下补丁免点击落盘，作者事后想回的是「Agent 动手之前」。这一份如果和 autosave
 * 挤同一个 20 份池子，写一会儿就先被冲掉；新建文件如果只记一份空内容快照，撤销就只能
 * 得到一个空文件而不是「没有这个文件」。这两条都在这里钉死。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

type MemFile = { content: string };
const disk = new Map<string, MemFile>();
let existsThrows = false;

function normalize(path: string): string {
  return path.replace(/\\/g, '/');
}

vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    writeFile: async (_root: string, path: string, content: string) => {
      disk.set(normalize(path), { content });
    },
    readFile: async (path: string) => {
      const file = disk.get(normalize(path));
      if (!file) throw new Error(`不存在: ${path}`);
      return file.content;
    },
    listDir: async (dir: string) => {
      const prefix = `${normalize(dir)}/`;
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
    pathExists: async (path: string) => {
      if (existsThrows) throw new Error('探测失败');
      return disk.has(normalize(path));
    },
    deletePath: async (_root: string, path: string) => {
      disk.delete(normalize(path));
    },
  },
}));

import { listVersions, snapshotBeforeWrite } from '../src/lib/versions';

const PROJECT = 'D:/连载/末世吞噬';
const FILE = 'D:/连载/末世吞噬/正文/第01章.md';
const VERSION_DIR = 'D:/连载/末世吞噬/.storyforge/versions/正文/第01章.md';

let clock = 1_700_000_000_000;

beforeEach(() => {
  disk.clear();
  existsThrows = false;
  clock = 1_700_000_000_000;
  // 快照文件名就是时间戳，同毫秒会互相覆盖；逐次推进才能测出淘汰行为。
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 只数该目录的直接子项——主目录前缀同时也是 checkpoints/ 的前缀，不排掉会把它一起算进来。 */
function snapshotPaths(sub = ''): string[] {
  const prefix = `${VERSION_DIR}${sub}/`;
  return [...disk.keys()].filter(
    (key) =>
      key.startsWith(prefix) &&
      key.endsWith('.snapshot.md') &&
      !key.slice(prefix.length).includes('/'),
  );
}

test('检查点落在 checkpoints/，普通快照落在主目录', async () => {
  disk.set(normalize(FILE), { content: '旧' });

  await snapshotBeforeWrite(PROJECT, FILE, '手存前', { source: 'Editor' });
  await snapshotBeforeWrite(PROJECT, FILE, 'agent 动手前', { source: 'Agent', checkpoint: true });

  assert.equal(snapshotPaths().length, 1, '主目录应只有那份手存快照');
  assert.equal(snapshotPaths('/checkpoints').length, 1, '检查点应落进 checkpoints/');
});

test('autosave 洪水冲不掉检查点：两个池子各算各的 20 份', async () => {
  disk.set(normalize(FILE), { content: '旧' });
  await snapshotBeforeWrite(PROJECT, FILE, 'agent 动手前', { source: 'Agent', checkpoint: true });

  for (let i = 0; i < 40; i += 1) {
    await snapshotBeforeWrite(PROJECT, FILE, `第 ${i} 次自动保存前`, { source: 'Editor' });
  }

  assert.equal(snapshotPaths().length, 20, '普通快照仍受 20 份上限约束');
  assert.equal(
    snapshotPaths('/checkpoints').length,
    1,
    '40 次 autosave 之后，Agent 动手前那份检查点必须还在',
  );
});

test('检查点自己也有上限，不会无限涨', async () => {
  disk.set(normalize(FILE), { content: '旧' });
  for (let i = 0; i < 30; i += 1) {
    await snapshotBeforeWrite(PROJECT, FILE, `第 ${i} 轮前`, { source: 'Agent', checkpoint: true });
  }
  assert.equal(snapshotPaths('/checkpoints').length, 20);
});

test('区分「新建」与「内容为空」', async () => {
  const created = await snapshotBeforeWrite(PROJECT, FILE, '', { source: 'Agent' });
  assert.equal(created?.created, true, '文件此前不存在时必须标 created');

  disk.set(normalize(FILE), { content: '' });
  const emptyButExisting = await snapshotBeforeWrite(PROJECT, FILE, '', { source: 'Agent' });
  assert.equal(emptyButExisting?.created, false, '空文件已存在时不能当作新建（撤销会误删）');
});

test('探测失败按「文件已存在」处理——宁可写回空内容也不误删', async () => {
  existsThrows = true;
  const result = await snapshotBeforeWrite(PROJECT, FILE, '', { source: 'Agent' });
  assert.equal(result?.created, false);
});

test('版本历史把两个目录合成一条倒序时间线并标出检查点', async () => {
  disk.set(normalize(FILE), { content: '旧' });
  await snapshotBeforeWrite(PROJECT, FILE, '手存前', { source: 'Editor' });
  await snapshotBeforeWrite(PROJECT, FILE, 'agent 动手前', {
    source: 'Agent',
    checkpoint: true,
    runId: 'run-7',
  });

  const versions = await listVersions(PROJECT, FILE);

  assert.equal(versions.length, 2);
  assert.equal(versions[0].timestamp > versions[1].timestamp, true, '必须按时间倒序');
  assert.equal(versions[0].checkpoint, true);
  assert.equal(versions[0].runId, 'run-7');
  assert.equal(versions[1].checkpoint, false);
});
