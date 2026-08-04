import assert from 'node:assert/strict';
import { test } from 'vitest';

import { buildStoryNavigationGroups } from '../src/components/StoryNavigator';
import { buildProjectIndexFromEntries } from '../src/lib/project-context';

test('story navigator groups markdown files by fiction semantics', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const index = buildProjectIndexFromEntries(projectPath, [
    {
      name: '林岚.md',
      path: `${projectPath}\\人物\\林岚.md`,
      isDir: false,
      size: 120,
      modified: 1,
      extension: 'md',
    },
    {
      name: '第01章.md',
      path: `${projectPath}\\正文\\第01章.md`,
      isDir: false,
      size: 240,
      modified: 2,
      extension: 'md',
    },
    {
      name: '黄金三章spec.md',
      path: `${projectPath}\\.资料\\黄金三章spec.md`,
      isDir: false,
      size: 180,
      modified: 3,
      extension: 'md',
    },
    {
      name: '验收.md',
      path: `${projectPath}\\质量\\验收.md`,
      isDir: false,
      size: 90,
      modified: 4,
      extension: 'md',
    },
  ]);

  const groups = buildStoryNavigationGroups(index.files);

  assert.deepEqual(
    groups.map((group) => group.kind),
    ['character', 'knowledge', 'draft', 'quality'],
  );
  assert.deepEqual(
    groups.map((group) => group.files.map((file) => file.relativePath)),
    [
      ['人物\\林岚.md'],
      ['.资料\\黄金三章spec.md'],
      ['正文\\第01章.md'],
      ['质量\\验收.md'],
    ],
  );
});
