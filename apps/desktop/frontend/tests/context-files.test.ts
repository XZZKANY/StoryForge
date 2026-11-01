import { beforeEach, expect, it } from 'vitest';
import type { FileEntry } from '@storyforge/project-core';

import { MAX_CONTEXT_FILES as ENGINE_MAX_CONTEXT_FILES } from '../../../../packages/engine/src/kernel/contextValues';
import { MAX_CONTEXT_FILES } from '@storyforge/project-core';
import { appendExplicitContextFiles } from '../src/components/chat-window/context-files';
import {
  buildContextBundle,
  type ContextBundle,
  type ContextBundleFile,
} from '../src/lib/project-context';
import { invalidateFileSystemCache } from '../src/lib/host/tauri-fs';

const PROJECT = 'D:/Books/context-files';
const disk = new Map<string, string>();

function entries(root = PROJECT): FileEntry[] {
  return [...disk.keys()]
    .filter((path) => path.startsWith(`${root}/`))
    .map((path) => ({
      path,
      name: path.split('/').at(-1) ?? '',
      isDir: false,
      isFile: true,
      extension: 'md',
      modified: 0,
      size: 100,
    }));
}

beforeEach(() => {
  disk.clear();
  window.__STORYFORGE_MOCK_FS__ = {
    readFile: (path: string) => {
      const value = disk.get(path);
      if (value === undefined) throw new Error('fixture source unavailable');
      return value;
    },
    listDir: entries,
    writeFile: (path, content) => {
      disk.set(path, content);
    },
  };
  invalidateFileSystemCache();
});

function bundleWith(
  files: ContextBundleFile[] = [],
  budget: Partial<ContextBundle['budget']> = {},
): ContextBundle {
  return {
    projectRoot: PROJECT,
    currentFile: null,
    files,
    summary: { hasStoryStructure: true, counts: {} as ContextBundle['summary']['counts'] },
    budget: {
      fileCount: files.length,
      charCount: 0,
      maxFiles: MAX_CONTEXT_FILES,
      maxExcerptChars: 1200,
      truncated: false,
      overflowCount: 0,
      unreadableCount: 0,
      pinnedFileCount: 0,
      missingPinnedFiles: [],
      ...budget,
    },
  };
}

function autoFile(index: number): ContextBundleFile {
  return {
    path: `${PROJECT}/大纲/auto-${index}.md`,
    relativePath: `大纲/auto-${index}.md`,
    kind: 'outline',
    title: `auto-${index}.md`,
    excerpt: `自动 ${index}`,
  };
}

const longText = (head: string, tail: string) => `${head}${'中'.repeat(3000)}${tail}`;

it('补入的正文取结尾，与自动选择一致', async () => {
  disk.set(`${PROJECT}/正文/第001章.md`, longText('开头标记', '结尾标记'));
  const { bundle } = await appendExplicitContextFiles(bundleWith(), PROJECT, ['正文/第001章.md']);
  const excerpt = bundle.files[0].excerpt;
  expect(excerpt.startsWith('……（本章前文略）')).toBe(true);
  expect(excerpt.endsWith('结尾标记')).toBe(true);
  expect(excerpt).not.toContain('开头标记');
});

it('补入的设定取开头，摘录上限 1200', async () => {
  disk.set(`${PROJECT}/设定/世界.md`, longText('开头标记', '结尾标记'));
  const { bundle } = await appendExplicitContextFiles(bundleWith(), PROJECT, ['设定/世界.md']);
  const excerpt = bundle.files[0].excerpt;
  expect(excerpt.startsWith('开头标记')).toBe(true);
  expect(excerpt).toHaveLength(1200);
  expect(bundle.budget.truncated).toBe(false);
});

it('内容为空的文件不加入，计入读取失败', async () => {
  disk.set(`${PROJECT}/设定/空.md`, '  \n\t ');
  const { bundle } = await appendExplicitContextFiles(bundleWith(), PROJECT, ['设定/空.md']);
  expect(bundle.files).toEqual([]);
  expect(bundle.budget.unreadableCount).toBe(1);
  expect(bundle.budget.overflowCount).toBe(0);
});

it('读不出的文件计入读取失败并留在未读到里', async () => {
  const result = await appendExplicitContextFiles(bundleWith(), PROJECT, ['设定/不存在.md']);
  expect(result.bundle.budget.unreadableCount).toBe(1);
  expect(result.missingPaths).toEqual(['设定/不存在.md']);
});

it('补读成功的路径从旧的未读到里去掉，补读也失败的才留下', async () => {
  disk.set(`${PROJECT}/设定/新建.md`, '刚写好的设定');
  const result = await appendExplicitContextFiles(
    bundleWith([], { missingPinnedFiles: ['设定\\新建.md', '设定/仍缺.md'] }),
    PROJECT,
    ['设定/新建.md', '设定/仍缺.md'],
  );
  expect(result.bundle.files.map((file) => file.relativePath)).toEqual(['设定/新建.md']);
  expect(result.bundle.budget.missingPinnedFiles).toEqual(['设定/仍缺.md']);
  expect(result.missingPaths).toEqual(['设定/仍缺.md']);
});

it('上限等于引擎常量，补入排前，挤掉的计入超出席位', async () => {
  disk.set(`${PROJECT}/设定/a.md`, '设定甲');
  disk.set(`${PROJECT}/设定/b.md`, '设定乙');
  const autos = Array.from({ length: MAX_CONTEXT_FILES }, (_, index) => autoFile(index));
  const { bundle } = await appendExplicitContextFiles(
    bundleWith(autos, { overflowCount: 1 }),
    PROJECT,
    ['设定/a.md', '设定/b.md'],
  );
  expect(MAX_CONTEXT_FILES).toBe(ENGINE_MAX_CONTEXT_FILES);
  expect(bundle.files).toHaveLength(MAX_CONTEXT_FILES);
  expect(bundle.budget.maxFiles).toBe(MAX_CONTEXT_FILES);
  expect(bundle.files.slice(0, 2).map((file) => file.relativePath)).toEqual([
    '设定/a.md',
    '设定/b.md',
  ]);
  expect(bundle.budget.overflowCount).toBe(3);
  expect(bundle.budget.truncated).toBe(true);
});

it('自动选择也分开记超出席位与读取失败', async () => {
  const root = 'D:/Books/context-files-auto';
  for (let index = 0; index < MAX_CONTEXT_FILES + 2; index += 1) {
    disk.set(
      `${root}/大纲/${String(index).padStart(2, '0')}.md`,
      index === 0 ? '   ' : `大纲 ${index}`,
    );
  }
  const bundle = await buildContextBundle({ projectPath: root, currentFile: null });
  expect(bundle.budget.maxFiles).toBe(MAX_CONTEXT_FILES);
  expect(bundle.budget.overflowCount).toBe(2);
  expect(bundle.budget.unreadableCount).toBe(1);
  expect(bundle.files).toHaveLength(MAX_CONTEXT_FILES - 1);
});
