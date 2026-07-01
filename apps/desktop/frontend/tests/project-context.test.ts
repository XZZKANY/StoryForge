import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildProjectIndexFromEntries,
  buildSampleStoryProjectFiles,
  buildStoryProjectInitializationPlan,
  classifyRelativePath,
  sampleStoryProjectPath,
  selectContextBundleFiles,
} from '../src/lib/project-context';
import { toAssistantContextBundlePayload } from '../src/lib/api-client';

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

test('sample story project seeds an immediately usable local manuscript', () => {
  const parentPath = 'D:\\StoryForge\\Books\\';
  const projectPath = sampleStoryProjectPath(parentPath);
  const files = buildSampleStoryProjectFiles(projectPath);

  assert.equal(projectPath, 'D:\\StoryForge\\Books\\StoryForge 示例项目');
  assert.deepEqual(files.map((file) => file.path), [
    'D:\\StoryForge\\Books\\StoryForge 示例项目\\大纲\\总纲.md',
    'D:\\StoryForge\\Books\\StoryForge 示例项目\\人物\\主角.md',
    'D:\\StoryForge\\Books\\StoryForge 示例项目\\正文\\第01章.md',
  ]);
  assert.ok(files[0].content.includes('让对话 agent 帮忙审稿'));
  assert.ok(files[2].content.includes('# 第01章'));
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

test('context bundle selection prioritizes pinned files and reports truncation/missing pins', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const entries = [
    ['总纲.md', '大纲\\总纲.md'],
    ['林岚.md', '人物\\林岚.md'],
    ['世界.md', '设定\\世界.md'],
    ['年表.md', '时间线\\年表.md'],
    ['第01章.md', '正文\\第01章.md'],
    ['导出稿.md', '导出\\导出稿.md'],
    ['质量报告.md', '质量\\质量报告.md'],
  ].map(([name, relative], index) => ({
    name,
    path: `${projectPath}\\${relative}`,
    isDir: false,
    size: 100 + index,
    modified: index,
    extension: 'md',
  }));
  const index = buildProjectIndexFromEntries(projectPath, entries);

  const selection = selectContextBundleFiles({
    index,
    currentFile: `${projectPath}\\正文\\第01章.md`,
    maxFiles: 2,
    pinnedFiles: ['人物\\林岚.md', '不存在.md'],
  });

  assert.deepEqual(selection.files.map((file) => file.relativePath), ['人物\\林岚.md', '大纲\\总纲.md']);
  assert.equal(selection.truncated, true);
  assert.deepEqual(selection.missingPinnedFiles, ['不存在.md']);
  assert.equal(selection.files.some((file) => file.relativePath.startsWith('导出')), false);
  assert.equal(selection.files.some((file) => file.relativePath.startsWith('质量')), false);
});

test('assistant context payload exposes budget in backend snake case', () => {
  const payload = toAssistantContextBundlePayload({
    projectRoot: 'D:\\StoryForge\\Books\\雾港回声',
    currentFile: 'D:\\StoryForge\\Books\\雾港回声\\正文\\第01章.md',
    files: [
      {
        path: 'D:\\StoryForge\\Books\\雾港回声\\人物\\林岚.md',
        relativePath: '人物\\林岚.md',
        kind: 'character',
        title: '林岚.md',
        excerpt: '林岚害怕失去证据。',
      },
    ],
    summary: {
      hasStoryStructure: true,
      counts: {
        outline: 1,
        character: 1,
        setting: 0,
        timeline: 0,
        foreshadowing: 0,
        draft: 1,
        quality: 0,
        export: 0,
        other: 0,
      },
    },
    budget: {
      fileCount: 1,
      charCount: 10,
      maxFiles: 8,
      maxExcerptChars: 1200,
      truncated: false,
      pinnedFileCount: 1,
      missingPinnedFiles: ['不存在.md'],
    },
  });

  assert.deepEqual(payload?.budget, {
    file_count: 1,
    char_count: 10,
    max_files: 8,
    max_excerpt_chars: 1200,
    truncated: false,
    pinned_file_count: 1,
    missing_pinned_files: ['不存在.md'],
  });
});
