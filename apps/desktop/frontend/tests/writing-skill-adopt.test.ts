import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

import { TauriFileSystem } from '../src/lib/tauri-fs';
import { adoptableSkills, adoptWritingSkills } from '../src/lib/writing-skill-adopt';

const PROJECT = 'D:\\连载\\末世吞噬';

afterEach(() => vi.restoreAllMocks());

const skill = (fileName: unknown, name = '开篇', content = '---\n名字：开篇\n---\n做法') => ({
  name,
  file_name: fileName,
  content,
});

test('只收形状完整、文件名只有一层的 skill', () => {
  const raw = JSON.stringify({
    skills: [
      skill('01-开篇.md'),
      skill('../越界.md'),
      skill('子目录\\逃逸.md'),
      skill('.隐藏.md'),
      skill('02-没扩展名'),
      skill(3),
      { name: '缺内容', file_name: '03-缺.md' },
      '坏的',
    ],
  });
  assert.deepEqual(adoptableSkills(raw), [
    { name: '开篇', relativePath: '写法/01-开篇.md', content: '---\n名字：开篇\n---\n做法' },
  ]);
  assert.deepEqual(adoptableSkills('{"skills": "不是列表"}'), []);
});

test('放进 写法/：先建目录，同名已有就跳过、不覆盖', async () => {
  const created: string[] = [];
  const dirs: string[] = [];
  vi.spyOn(TauriFileSystem, 'createDir').mockImplementation(async (_root, path) => {
    dirs.push(path);
  });
  vi.spyOn(TauriFileSystem, 'projectPathExists').mockImplementation(async (_root, path) =>
    path.endsWith('02-章末.md'),
  );
  vi.spyOn(TauriFileSystem, 'writeFileIfUnchanged').mockImplementation(
    async (_root, path, _content, expected) => {
      assert.deepEqual(expected, { kind: 'missing' });
      created.push(path);
    },
  );
  const result = await adoptWritingSkills(PROJECT, [
    { name: '开篇', relativePath: '写法/01-开篇.md', content: 'a' },
    { name: '章末钩子', relativePath: '写法/02-章末.md', content: 'b' },
  ]);
  assert.deepEqual(
    result.created.map((item) => item.name),
    ['开篇'],
  );
  assert.deepEqual(
    result.skipped.map((item) => item.name),
    ['章末钩子'],
  );
  assert.equal(dirs.length, 1);
  assert.match(dirs[0], /写法$/);
  assert.equal(created.length, 1);
  assert.match(created[0], /写法[\\/]01-开篇\.md$/);
});
