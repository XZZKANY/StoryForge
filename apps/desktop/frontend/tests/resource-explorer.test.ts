import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  isAuthorInstructionsPath,
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

test('作者自定义指令必须在产品内看得见、打得开', () => {
  // 诊断（2026-07-29）：`.storyforge/agent-instructions.md` 是作者写给 agent 的长期偏好，
  // 也是唯一跨会话的记忆载体，此前被这个白名单挡掉——文件树、快速打开、项目搜索三处
  // 入口同时封死。作者能右键 `.storyforge` 新建文件，但一旦命名为它就立刻从树上消失。
  const instructions = entry('D:\\Book\\.storyforge\\agent-instructions.md', false, 'md');
  assert.equal(isVisibleProjectTreeEntry(instructions), true);
  assert.equal(isOpenableProjectFileEntry(instructions), true);
  assert.equal(isAuthorInstructionsPath(instructions.path), true);

  // 放行的只有这一个文件，`.storyforge` 其余内部制品仍然隐藏。
  assert.equal(
    isVisibleProjectTreeEntry(entry('D:\\Book\\.storyforge\\versions\\x.md', false, 'md')),
    false,
  );
  assert.equal(isAuthorInstructionsPath('D:\\Book\\正文\\第001章.md'), false);
  assert.equal(isAuthorInstructionsPath(null), false);
});
