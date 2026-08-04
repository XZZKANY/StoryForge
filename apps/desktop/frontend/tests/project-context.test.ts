import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildProjectIndexFromEntries,
  buildSampleStoryProjectFiles,
  buildStoryProjectInitializationPlan,
  classifyRelativePath,
  excerptForContext,
  isPathInsideProject,
  parseProjectKnowledgeSelection,
  readProjectKnowledgeSelection,
  reconcileProjectKnowledgeSelection,
  relativePathInsideProject,
  resolveProjectRelativePath,
  sampleStoryProjectPath,
  selectContextBundleFiles,
  writeProjectKnowledgeSelection,
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
  assert.deepEqual(
    files.map((file) => file.path),
    [
      'D:\\StoryForge\\Books\\StoryForge 示例项目\\大纲\\总纲.md',
      'D:\\StoryForge\\Books\\StoryForge 示例项目\\人物\\主角.md',
      'D:\\StoryForge\\Books\\StoryForge 示例项目\\正文\\第01章.md',
    ],
  );
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

test('project index exposes only allowlisted project knowledge', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const entry = (relativePath: string, extension: string) => ({
    name: relativePath.split('\\').at(-1) ?? relativePath,
    path: `${projectPath}\\${relativePath}`,
    isDir: false,
    size: 100,
    modified: 1,
    extension,
  });
  const index = buildProjectIndexFromEntries(projectPath, [
    entry('.资料\\黄金三章spec.md', 'md'),
    entry('.storyforge\\book.json', 'json'),
    entry('.storyforge\\agent-instructions.md', 'md'),
    entry('.storyforge\\serial-plan.json', 'json'),
    entry('.storyforge\\canon\\canon.json', 'json'),
    entry('.storyforge\\canon\\hooks.json', 'json'),
    entry('.storyforge\\config.json', 'json'),
    entry('.storyforge\\canon\\derived\\dossier.md', 'md'),
    entry('.secret\\notes.md', 'md'),
    entry('.资料\\access-token.md', 'md'),
    entry('.资料\\config\\internal.md', 'md'),
    {
      ...entry('.资料\\too-large.md', 'md'),
      size: 512 * 1024 + 1,
    },
  ]);

  assert.equal(classifyRelativePath('.资料/黄金三章spec.md'), 'knowledge');
  assert.equal(index.summary.hasStoryStructure, true);
  assert.deepEqual(
    index.files.map((file) => [file.relativePath.replace(/\\/g, '/'), file.kind]),
    [
      ['.资料/黄金三章spec.md', 'knowledge'],
      ['.storyforge/agent-instructions.md', 'knowledge'],
      ['.storyforge/book.json', 'knowledge'],
      ['.storyforge/canon/canon.json', 'knowledge'],
      ['.storyforge/canon/hooks.json', 'knowledge'],
      ['.storyforge/serial-plan.json', 'knowledge'],
    ],
  );
});

test('project knowledge is injected only when explicitly pinned', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const index = buildProjectIndexFromEntries(projectPath, [
    {
      name: '黄金三章spec.md',
      path: `${projectPath}\\.资料\\黄金三章spec.md`,
      isDir: false,
      size: 100,
      modified: 1,
      extension: 'md',
    },
    {
      name: '总纲.md',
      path: `${projectPath}\\大纲\\总纲.md`,
      isDir: false,
      size: 100,
      modified: 1,
      extension: 'md',
    },
  ]);

  assert.deepEqual(
    selectContextBundleFiles({ index, currentFile: null, maxFiles: 8 }).files.map(
      (file) => file.relativePath,
    ),
    ['大纲\\总纲.md'],
  );
  assert.deepEqual(
    selectContextBundleFiles({
      index,
      currentFile: null,
      maxFiles: 8,
      pinnedFiles: ['.资料/黄金三章spec.md'],
    }).files.map((file) => file.relativePath),
    ['.资料\\黄金三章spec.md', '大纲\\总纲.md'],
  );
});

test('project knowledge selection storage rejects unsafe values and reconciles stale paths', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const saved = writeProjectKnowledgeSelection(
    projectPath,
    ['.资料\\规则.md', '../outside.md', 'D:\\outside.md', '.资料/规则.md', 'file://x'],
    storage,
  );

  assert.deepEqual(saved, ['.资料/规则.md']);
  assert.deepEqual(readProjectKnowledgeSelection(projectPath, storage), ['.资料/规则.md']);
  assert.deepEqual(parseProjectKnowledgeSelection('{broken'), []);
  assert.deepEqual(
    reconcileProjectKnowledgeSelection(
      ['.资料/规则.md', '.资料/已删除.md'],
      [
        {
          name: '规则.md',
          path: `${projectPath}\\.资料\\规则.md`,
          relativePath: '.资料\\规则.md',
          kind: 'knowledge',
          size: 100,
          modified: 1,
        },
      ],
    ),
    { selected: ['.资料\\规则.md'], missing: ['.资料/已删除.md'] },
  );
});

test('project path containment rejects sibling prefixes, absolutes outside, and traversal', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';

  assert.equal(
    relativePathInsideProject(projectPath, 'D:\\StoryForge\\Books\\雾港回声\\正文\\第01章.md'),
    '正文\\第01章.md',
  );
  assert.equal(
    isPathInsideProject(projectPath, 'D:\\StoryForge\\Books\\雾港回声2\\secret.md'),
    false,
  );
  assert.equal(
    resolveProjectRelativePath(projectPath, '正文\\第02章.md'),
    'D:\\StoryForge\\Books\\雾港回声\\正文\\第02章.md',
  );
  assert.equal(resolveProjectRelativePath(projectPath, '..\\secret.md'), null);
  assert.equal(resolveProjectRelativePath(projectPath, 'D:\\StoryForge\\Books\\outside.md'), null);
});

test('project index drops entries outside the active project boundary', () => {
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
      name: 'secret.md',
      path: 'D:\\StoryForge\\Books\\雾港回声2\\secret.md',
      isDir: false,
      size: 100,
      modified: 1,
      extension: 'md',
    },
  ]);

  assert.deepEqual(
    index.files.map((file) => file.relativePath),
    ['正文\\第01章.md'],
  );
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

  assert.deepEqual(
    selection.files.map((file) => file.relativePath),
    ['人物\\林岚.md', '大纲\\总纲.md'],
  );
  assert.equal(selection.truncated, true);
  assert.deepEqual(selection.missingPinnedFiles, ['不存在.md']);
  assert.equal(
    selection.files.some((file) => file.relativePath.startsWith('导出')),
    false,
  );
  assert.equal(
    selection.files.some((file) => file.relativePath.startsWith('质量')),
    false,
  );
});

function serialProjectIndex(projectPath: string, chapterCount: number) {
  const entries = [
    ['总纲.md', '大纲\\总纲.md'],
    ['林岚.md', '人物\\林岚.md'],
    ['陈默.md', '人物\\陈默.md'],
    ['世界.md', '设定\\世界.md'],
    ['规则.md', '设定\\规则.md'],
    ['年表.md', '时间线\\年表.md'],
    ['埋线.md', '伏笔\\埋线.md'],
  ];
  for (let n = 1; n <= chapterCount; n += 1) {
    const name = `第${String(n).padStart(3, '0')}章.md`;
    entries.push([name, `正文\\${name}`]);
  }
  return buildProjectIndexFromEntries(
    projectPath,
    entries.map(([name, relative], index) => ({
      name,
      path: `${projectPath}\\${relative}`,
      isDir: false,
      size: 100 + index,
      modified: index,
      extension: 'md',
    })),
  );
}

test('auto context follows the serial frontier instead of always feeding chapters 1-8', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const index = serialProjectIndex(projectPath, 30);

  const selection = selectContextBundleFiles({
    index,
    currentFile: `${projectPath}\\正文\\第030章.md`,
    maxFiles: 8,
  });
  const drafts = selection.files
    .filter((file) => file.kind === 'draft')
    .map((file) => file.relativePath);

  // 写第 30 章时喂开篇几章是纯浪费；接得上的是紧邻的前几章。
  assert.ok(drafts.length > 0, '正文必须有席位');
  assert.deepEqual(drafts, ['正文\\第029章.md', '正文\\第028章.md'].slice(0, drafts.length));
  assert.equal(
    drafts.some((path) => path === '正文\\第001章.md'),
    false,
  );
});

test('the immediately preceding chapter outranks character and setting files', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const index = serialProjectIndex(projectPath, 30);

  const selection = selectContextBundleFiles({
    index,
    currentFile: `${projectPath}\\正文\\第030章.md`,
    maxFiles: 2,
  });

  // 只剩两个席位时，上一章必须挤得进来（仅次于大纲），否则续写永远接不上笔。
  assert.deepEqual(
    selection.files.map((file) => file.relativePath),
    ['大纲\\总纲.md', '正文\\第029章.md'],
  );
});

function crowdedSerialProjectIndex(projectPath: string) {
  const entries = [
    ['总纲.md', '大纲\\总纲.md'],
    ['第二卷纲.md', '大纲\\第二卷纲.md'],
    ['世界.md', '设定\\世界.md'],
    ['规则.md', '设定\\规则.md'],
    ['年表.md', '时间线\\年表.md'],
    ['埋线.md', '伏笔\\埋线.md'],
  ];
  // 长篇写到三十章，人物卡攒到十张是常态，不是极端构造。
  for (let n = 1; n <= 10; n += 1) {
    entries.push([`人物${n}.md`, `人物\\人物${n}.md`]);
  }
  for (let n = 1; n <= 30; n += 1) {
    const name = `第${String(n).padStart(3, '0')}章.md`;
    entries.push([name, `正文\\${name}`]);
  }
  return buildProjectIndexFromEntries(
    projectPath,
    entries.map(([name, relative], index) => ({
      name,
      path: `${projectPath}\\${relative}`,
      isDir: false,
      size: 100 + index,
      modified: index,
      extension: 'md',
    })),
  );
}

test('a crowded character folder no longer starves setting / timeline / foreshadowing', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const selection = selectContextBundleFiles({
    index: crowdedSerialProjectIndex(projectPath),
    currentFile: `${projectPath}\\正文\\第030章.md`,
    maxFiles: 8,
  });

  // 严格按优先级铺满时，8 席被大纲 2 + 上一章 1 + 人物 5 吃干净：模型写第 30 章
  // 手里一条世界规则、一条时间线、一条伏笔都没有。类目之间是互补的，少一整类
  // 比某一类少一篇伤得多。
  const kinds = new Set(selection.files.map((file) => file.kind));
  for (const kind of ['outline', 'character', 'setting', 'timeline', 'foreshadowing', 'draft']) {
    assert.ok(kinds.has(kind as never), `${kind} 必须有席位`);
  }
  assert.equal(selection.files.length, 8);
});

test('context seats rotate across kinds by priority instead of filling top-down', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const selection = selectContextBundleFiles({
    index: crowdedSerialProjectIndex(projectPath),
    currentFile: `${projectPath}\\正文\\第030章.md`,
    maxFiles: 8,
  });

  // 第一轮每个类目各拿一席（大纲 → 上一章 → 人物 → 设定 → 时间线 → 伏笔 → 邻章），
  // 第二轮才回头填大纲的第二篇。
  assert.deepEqual(
    selection.files.map((file) => file.kind),
    ['outline', 'draft', 'character', 'setting', 'timeline', 'foreshadowing', 'draft', 'outline'],
  );
  assert.equal(selection.files[1].relativePath, '正文\\第029章.md', '上一章仍紧随大纲');
});

test('drafts fall back to the newest chapters when the open file is not a chapter', () => {
  const projectPath = 'D:\\StoryForge\\Books\\雾港回声';
  const index = serialProjectIndex(projectPath, 30);

  const selection = selectContextBundleFiles({
    index,
    currentFile: `${projectPath}\\人物\\林岚.md`,
    maxFiles: 9,
  });
  const drafts = selection.files
    .filter((file) => file.kind === 'draft')
    .map((file) => file.relativePath);

  assert.ok(drafts.length > 0, '正文必须有席位');
  assert.equal(drafts[0], '正文\\第030章.md');
});

test('draft excerpts keep the ending, other kinds keep the opening', () => {
  const chapter = `${'开'.repeat(50)}${'中'.repeat(50)}${'尾'.repeat(50)}`;

  const draft = excerptForContext(chapter, 'draft', 50);
  assert.ok(draft.endsWith('尾'.repeat(50)), '正文摘录必须保住结尾');
  assert.equal(draft.includes('开'), false, '正文摘录不该再喂开头');
  assert.ok(draft.startsWith('……（本章前文略）'), '截断要对模型显式说明');

  const outline = excerptForContext(chapter, 'outline', 50);
  assert.equal(outline, '开'.repeat(50), '结构化文档的纲要在头部');

  assert.equal(excerptForContext('  短文  ', 'draft', 50), '短文', '不超预算时原样给出');
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
