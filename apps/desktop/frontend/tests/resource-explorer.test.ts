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

test('反斜杠作品：文件夹节点的路径与宿主列出的文件夹条目同一种写法，不再是 `D:/书/正文` 混合写法', () => {
  // 宿主在 Windows 上照传进去的作品根往下拼反斜杠；条目按名字排序，下层文件夹可能先于上层出现。
  const book = 'D:\\连载\\末世吞噬';
  const hostEntries = [
    entry(`${book}\\正文\\卷一`, true),
    entry(`${book}\\正文`, true),
    entry(`${book}\\正文\\卷一\\第001章.md`, false, 'md'),
    entry(`${book}\\大纲.md`, false, 'md'),
  ];
  const tree = buildProjectTree(hostEntries, book);
  const manuscript = tree.find((node) => node.name === '正文')!;
  const volume = manuscript.children.find((node) => node.name === '卷一')!;
  assert.equal(manuscript.path, hostEntries[1].path);
  assert.equal(volume.path, hostEntries[0].path);
  assert.equal(volume.children[0].path, hostEntries[2].path);
  assert.equal(
    tree
      .flatMap(function paths(node): string[] {
        return [node.path, ...node.children.flatMap(paths)];
      })
      .filter((path) => path.includes('/')).length,
    0,
    '整棵树里没有一个正斜杠',
  );
  // 作品在盘符根上时，根自己的反斜杠也算数。
  assert.equal(buildProjectTree([entry('D:\\正文', true)], 'D:\\')[0].path, 'D:\\正文');
});

test('作者自定义指令必须在产品内看得见、打得开', () => {
  // 诊断（2026-07-29）：`.storyforge/agent-instructions.md` 是作者写给 agent 的长期偏好，
  // 也是唯一跨会话的记忆载体，此前被这个白名单挡掉——文件树、快速打开、项目搜索三处
  // 入口同时封死。作者能右键 `.storyforge` 新建文件，但一旦命名为它就立刻从树上消失。
  const instructions = entry('D:\\Book\\.storyforge\\agent-instructions.md', false, 'md');
  assert.equal(isVisibleProjectTreeEntry(instructions), true);
  assert.equal(isOpenableProjectFileEntry(instructions), true);

  // 放行的只有这一个文件，`.storyforge` 其余内部制品仍然隐藏。
  assert.equal(
    isVisibleProjectTreeEntry(entry('D:\\Book\\.storyforge\\versions\\x.md', false, 'md')),
    false,
  );
});

test('文件树先列正文：点目录排在同类后面，目录仍在文件前面，每一层都一样', () => {
  const tree = buildProjectTree(
    [
      entry('D:/Book/.草稿', true),
      entry('D:/Book/.草稿/废稿.md', false, 'md'),
      entry('D:/Book/.storyforge', true),
      entry('D:/Book/.留底', true),
      entry('D:/Book/正文', true),
      entry('D:/Book/正文/.备注', true),
      entry('D:/Book/正文/第001章.md', false, 'md'),
      entry('D:/Book/人物', true),
      entry('D:/Book/大纲.md', false, 'md'),
    ],
    'D:/Book',
  );
  const names = tree.map((node) => node.name);
  // 普通目录在前、点目录在后，最后才是文件；同组内按名字排（与改动前同一个 localeCompare）。
  assert.deepEqual(
    names.slice(0, 2),
    ['人物', '正文'].sort((a, b) => a.localeCompare(b)),
  );
  assert.deepEqual(
    names.slice(2, 5),
    ['.storyforge', '.留底', '.草稿'].sort((a, b) => a.localeCompare(b)),
  );
  assert.deepEqual(names.slice(5), ['大纲.md']);
  assert.equal(tree[0].name.startsWith('.'), false, '第一项不是点目录');
  const manuscript = tree.find((node) => node.name === '正文')!;
  assert.deepEqual(
    manuscript.children.map((node) => node.name),
    ['.备注', '第001章.md'],
    '目录仍排在文件前面',
  );
});
