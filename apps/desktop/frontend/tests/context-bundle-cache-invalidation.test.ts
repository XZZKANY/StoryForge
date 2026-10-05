/**
 * C10：context bundle 缓存必须被文件保存/删除/改名事件失效。
 *
 * 报告 §3 C10（旧第 16 页）：30 秒缓存中，1 秒内保存或删源仍返回旧对象和旧摘录；
 * TTL 到期对照才刷新。修法：写/删/改名广播 FS_MUTATION_EVENT 后按前缀失效缓存。
 */

import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

import { buildContextBundle, invalidateContextBundleCache } from '../src/lib/project-context';
import { TauriFileSystem, FS_MUTATION_EVENT } from '../src/lib/tauri-fs';
import type { FileEntry } from '@storyforge/project-core';

vi.mock('../src/lib/tauri-fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/tauri-fs')>();
  return {
    ...actual,
    TauriFileSystem: {
      readProjectFile: vi.fn(),
      listDir: vi.fn(),
    },
  };
});

const PROJECT = 'D:/Books/雾港回声';

const entries = (names: string[]): FileEntry[] =>
  names.map((name) => ({
    path: `${PROJECT}/设定/${name}`,
    name,
    isDir: false,
    isFile: true,
    size: 100,
    modified: 0,
    extension: 'md',
  }));

const disk = new Map<string, string>();

beforeEach(() => {
  disk.clear();
  disk.set(`${PROJECT}/设定/规则.md`, 'VERSION_ONE 规则正文。');
  // 测试间不得共享模块级 bundle 缓存。
  invalidateContextBundleCache(PROJECT);
  vi.mocked(TauriFileSystem.readProjectFile).mockImplementation(async (_root, path) => {
    const content = disk.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  });
  vi.mocked(TauriFileSystem.listDir).mockImplementation(async () => entries(['规则.md']));
});

function fireMutation(path?: string): void {
  window.dispatchEvent(new CustomEvent<{ path?: string }>(FS_MUTATION_EVENT, { detail: { path } }));
}

test('save invalidates cached bundle within TTL', async () => {
  const first = await buildContextBundle({ projectPath: PROJECT, currentFile: null });
  assert.ok(first.files[0].excerpt.includes('VERSION_ONE'));

  // 1 秒内（远小于 30 秒 TTL）作者保存了新内容。
  disk.set(`${PROJECT}/设定/规则.md`, 'VERSION_TWO 规则正文改。');
  fireMutation(`${PROJECT}/设定/规则.md`);

  const second = await buildContextBundle({ projectPath: PROJECT, currentFile: null });
  assert.ok(
    second.files[0].excerpt.includes('VERSION_TWO'),
    '保存后缓存必须失效，不得把旧摘录发给后端',
  );
});

test('delete invalidates cached bundle within TTL', async () => {
  await buildContextBundle({ projectPath: PROJECT, currentFile: null });

  disk.delete(`${PROJECT}/设定/规则.md`);
  fireMutation(`${PROJECT}/设定/规则.md`);

  const after = await buildContextBundle({ projectPath: PROJECT, currentFile: null });
  assert.equal(after.files.length, 0, '删除源文件后缓存不得继续返回旧对象');
});

test('explicit invalidate API clears cache', async () => {
  const first = await buildContextBundle({ projectPath: PROJECT, currentFile: null });
  assert.ok(first.files[0].excerpt.includes('VERSION_ONE'));

  disk.set(`${PROJECT}/设定/规则.md`, 'VERSION_TWO 规则正文改。');
  invalidateContextBundleCache(PROJECT);

  const second = await buildContextBundle({ projectPath: PROJECT, currentFile: null });
  assert.ok(second.files[0].excerpt.includes('VERSION_TWO'));
});

test('mutation in another project does not clear this cache', async () => {
  await buildContextBundle({ projectPath: PROJECT, currentFile: null });

  fireMutation('D:/Books/别的项目/设定/规则.md');

  const second = await buildContextBundle({ projectPath: PROJECT, currentFile: null });
  // 仍在 TTL 内且未失效 → 返回缓存对象（引用相等）。
  assert.equal(second.files.length, 1);
});

test('mutation without path clears all caches', async () => {
  await buildContextBundle({ projectPath: PROJECT, currentFile: null });

  disk.set(`${PROJECT}/设定/规则.md`, 'VERSION_TWO 规则正文改。');
  fireMutation();

  const second = await buildContextBundle({ projectPath: PROJECT, currentFile: null });
  assert.ok(second.files[0].excerpt.includes('VERSION_TWO'));
});
