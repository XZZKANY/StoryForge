import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildStoryProjectInitializationPlan } from '../src/lib/project-context';

test('story project initialization plan creates the canonical local writing structure', () => {
  const plan = buildStoryProjectInitializationPlan('D:\\StoryForge\\Books\\雾港回声\\');

  assert.deepEqual(plan.directories, [
    'D:\\StoryForge\\Books\\雾港回声\\大纲',
    'D:\\StoryForge\\Books\\雾港回声\\人物',
    'D:\\StoryForge\\Books\\雾港回声\\设定',
    'D:\\StoryForge\\Books\\雾港回声\\正文',
    'D:\\StoryForge\\Books\\雾港回声\\质量',
    'D:\\StoryForge\\Books\\雾港回声\\导出',
  ]);
  assert.equal(plan.readmePath, 'D:\\StoryForge\\Books\\雾港回声\\大纲\\项目说明.md');
  assert.ok(plan.readmeContent.includes('- 正文：存放章节正文。'));
});
