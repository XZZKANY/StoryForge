import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  isCanonDeclarationPath,
  isOpenableProjectFileEntry,
  isReadOnlyDerivedProjectPath,
  isVisibleProjectTreeEntry,
} from '../src/lib/project/entry-visibility';
import { buildProjectTree } from '../src/lib/project/tree';
import type { FileEntry } from '../src/lib/tauri-fs';

function entry(path: string, isDir: boolean, extension?: string): FileEntry {
  return { name: path.split(/[\\/]/).at(-1) ?? path, path, isDir, extension } as FileEntry;
}

test('资源树公开 Canon dossier，但继续隐藏其他 .storyforge 内部制品', () => {
  assert.equal(isVisibleProjectTreeEntry(entry('D:\\Book\\.storyforge', true)), true);
  assert.equal(isVisibleProjectTreeEntry(entry('D:\\Book\\.storyforge\\canon', true)), true);
  assert.equal(
    isVisibleProjectTreeEntry(entry('D:\\Book\\.storyforge\\canon\\derived', true)),
    true,
  );
  assert.equal(
    isVisibleProjectTreeEntry(
      entry('D:\\Book\\.storyforge\\canon\\derived\\dossier.md', false, 'md'),
    ),
    true,
  );
  assert.equal(
    isVisibleProjectTreeEntry(
      entry('D:\\Book\\.storyforge\\canon\\derived\\presence.json', false, 'json'),
    ),
    false,
  );
  assert.equal(
    isVisibleProjectTreeEntry(
      entry('D:\\Book\\.storyforge\\versions\\chapter.snapshot.md', false, 'md'),
    ),
    false,
  );
  assert.equal(
    isOpenableProjectFileEntry(
      entry('D:\\Book\\.storyforge\\canon\\derived\\dossier.md', false, 'md'),
    ),
    true,
  );
  assert.equal(
    isOpenableProjectFileEntry(entry('D:\\Book\\.storyforge\\canon\\canon.json', false, 'json')),
    true,
  );
  assert.equal(isCanonDeclarationPath('D:\\Book\\.storyforge\\canon\\canon.json'), true);
  assert.equal(
    isReadOnlyDerivedProjectPath('D:\\Book\\.storyforge\\canon\\derived\\dossier.md'),
    true,
  );
  assert.equal(isVisibleProjectTreeEntry(entry('D:\\Book\\正文\\CHAPTER.MD', false, 'MD')), true);
});

test('项目树忽略 listDir 返回的项目根条目', () => {
  const tree = buildProjectTree(
    [
      entry('D:\\Book', true),
      entry('D:\\Book\\正文', true),
      entry('D:\\Book\\正文\\1.md', false, 'md'),
    ],
    'D:\\Book',
  );
  assert.deepEqual(
    tree.map((node) => node.name),
    ['正文'],
  );
});
