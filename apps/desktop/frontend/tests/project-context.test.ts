import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildProjectIndexFromEntries,
  buildStoryProjectInitializationPlan,
  classifyRelativePath,
} from '../src/lib/project-context';

test('story project initialization plan creates the canonical local writing structure', () => {
  const plan = buildStoryProjectInitializationPlan('D:\\StoryForge\\Books\\雾港回声\\');

  assert.deepEqual(plan.directories, [
    'D:\\StoryForge\\Books\\雾港回声\\正文',
    'D:\\StoryForge\\Books\\雾港回声\\大纲',
    'D:\\StoryForge\\Books\\雾港回声\\人物',
    'D:\\StoryForge\\Books\\雾港回声\\设定',
    'D:\\StoryForge\\Books\\雾港回声\\世界观',
    'D:\\StoryForge\\Books\\雾港回声\\时间线',
    'D:\\StoryForge\\Books\\雾港回声\\伏笔',
  ]);
  assert.equal(plan.readmePath, 'D:\\StoryForge\\Books\\雾港回声\\大纲\\项目说明.md');
  assert.ok(plan.readmeContent.includes('- 正文：存放章节正文。'));
  assert.ok(plan.readmeContent.includes('- 世界观：存放世界底层规则、势力、历史和专有名词。'));
  assert.ok(plan.readmeContent.includes('- 时间线：存放事件顺序、回忆、伏笔兑现节点。'));
  assert.ok(plan.readmeContent.includes('- 伏笔：存放埋线、回收计划、读者预期管理。'));
});

test('project index recognizes canonical fiction context folders', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const index = buildProjectIndexFromEntries(projectPath, [
    {
      name: '第01章.md',
      path: `${projectPath}\\正文\\第01章.md`,
      isDir: false,
      size: 100,
      modified: 1,
      extension: 'md',
    },
    {
      name: '年表.md',
      path: `${projectPath}\\时间线\\年表.md`,
      isDir: false,
      size: 80,
      modified: 1,
      extension: 'md',
    },
    {
      name: '埋线.md',
      path: `${projectPath}\\伏笔\\埋线.md`,
      isDir: false,
      size: 80,
      modified: 1,
      extension: 'md',
    },
  ]);

  assert.equal(classifyRelativePath('世界观/术语.md'), 'setting');
  assert.equal(index.summary.hasStoryStructure, true);
  assert.equal(index.summary.counts.draft, 1);
  assert.equal(index.summary.counts.timeline, 1);
  assert.equal(index.summary.counts.foreshadowing, 1);
});
