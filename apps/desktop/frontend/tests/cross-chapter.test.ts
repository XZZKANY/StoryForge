import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  chapterTargetPath,
  chapterWriteTarget,
  formatCrossChapterFindings,
  planChapterSubmission,
  resolveChapterRefs,
} from '../src/components/chat-window/cross-chapter';
import { requestCrossChapterConsistency } from '../src/lib/api/cross-chapter';
import type { SemanticFile } from '../src/lib/project/types';

function draft(name: string, path: string): SemanticFile {
  return { path, relativePath: name, name, kind: 'draft', modified: 0, size: 0 };
}

const files: SemanticFile[] = [
  draft('第01章.md', '/proj/正文/第01章.md'),
  draft('第02章.md', '/proj/正文/第02章.md'),
  draft('第03章.md', '/proj/正文/第03章.md'),
  {
    path: '/proj/人物/沈砚.md',
    relativePath: '人物/沈砚.md',
    name: '沈砚.md',
    kind: 'character',
    modified: 0,
    size: 0,
  },
];

test('resolveChapterRefs maps 第N章 to draft files, zero-pad-insensitive, ordered', () => {
  const refs = resolveChapterRefs('第1章 跟 第3章 时间线对不对', files);
  assert.deepEqual(
    refs.map((ref) => ref.name),
    ['第01章', '第03章'],
  );
  assert.deepEqual(
    refs.map((ref) => ref.path),
    ['/proj/正文/第01章.md', '/proj/正文/第03章.md'],
  );
});

test('resolveChapterRefs supports @N and dedupes the same chapter', () => {
  const refs = resolveChapterRefs('@2 和 第2章 还有 @3', files);
  assert.deepEqual(
    refs.map((ref) => ref.name),
    ['第02章', '第03章'],
  );
});

test('resolveChapterRefs returns fewer than 2 when only one chapter is named', () => {
  assert.equal(resolveChapterRefs('把第1章改紧张', files).length, 1);
});

test('formatCrossChapterFindings renders findings with citations', () => {
  const text = formatCrossChapterFindings(
    [
      {
        type: 'naming',
        severity: 'high',
        chapters: ['第01章', '第02章'],
        finding: '主角称谓漂移',
        evidence: '沈砚/沈岩',
      },
    ],
    ['第01章', '第02章'],
    'deepseek-v4-pro',
  );
  assert.match(text, /发现 1 条/);
  assert.match(text, /naming·high/);
  assert.match(text, /沈砚\/沈岩/);
});

test('formatCrossChapterFindings reports a clean check', () => {
  const text = formatCrossChapterFindings([], ['第01章', '第03章'], null);
  assert.match(text, /未发现跨章硬冲突/);
});

test('requestCrossChapterConsistency posts chapters and maps the response', async () => {
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          findings: [
            {
              type: 'setting',
              severity: 'high',
              chapters: ['第01章', '第03章'],
              finding: '位置矛盾',
              evidence: '东南角/城北角',
            },
          ],
          model: 'deepseek-v4-pro',
          latency_ms: 42,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  try {
    const result = await requestCrossChapterConsistency({
      chapters: [
        { name: '第01章', content: '旧水门在东南角' },
        { name: '第03章', content: '旧水门在城北角' },
      ],
      focus: '设定一致性',
    });

    assert.equal(fetchCalls[0].url, 'http://127.0.0.1:8000/api/ide/review/cross-chapter');
    assert.equal(fetchCalls[0].init?.method, 'POST');
    assert.equal(
      (fetchCalls[0].init?.headers as Record<string, string>)['X-StoryForge-API-Key'],
      'local-dev-key',
    );
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), {
      chapters: [
        { name: '第01章', content: '旧水门在东南角' },
        { name: '第03章', content: '旧水门在城北角' },
      ],
      focus: '设定一致性',
    });
    assert.equal(result.findings[0].type, 'setting');
    assert.equal(result.model, 'deepseek-v4-pro');
    assert.equal(result.latencyMs, 42);
  } finally {
    if (previousFetch) {
      Object.defineProperty(globalThis, 'fetch', previousFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});

function draftFile(name: string, relativePath: string): SemanticFile {
  return { path: `/proj/${relativePath}`, relativePath, name, kind: 'draft', modified: 0, size: 0 };
}

const chapterDrafts: SemanticFile[] = [
  draftFile('第01章.md', '正文/第01章.md'),
  draftFile('第02章.md', '正文/第02章.md'),
  draftFile('第03章.md', '正文/第03章.md'),
];

test('T03: 有写操作时 ≥2 引用章降为上下文并走 agent，不再被跨章通道抢走', () => {
  const plan = planChapterSubmission('参考第2章和第3章，写第4章', chapterDrafts);
  assert.deepEqual(plan, {
    channel: 'agent',
    intent: 'chapter.write',
    targetFilePath: '正文/第004章.md',
    contextPaths: ['正文/第02章.md', '正文/第03章.md'],
    planFallback: false,
  });
});

test('T03: 纯比较问题（无操作意图）仍走跨章通道', () => {
  const plan = planChapterSubmission('检查第1章和第2章是否一致', chapterDrafts);
  assert.equal(plan.channel, 'cross-chapter');
  if (plan.channel === 'cross-chapter') {
    assert.deepEqual(
      plan.refs.map((ref) => ref.name),
      ['第01章', '第02章'],
    );
  }
});

test('T09: 写目标章不存在（新章）不被吞，按 003 补零约定推导目标路径', () => {
  const plan = planChapterSubmission('写第4章', chapterDrafts);
  assert.deepEqual(plan, {
    channel: 'agent',
    intent: 'chapter.write',
    targetFilePath: '正文/第004章.md',
    contextPaths: [],
    planFallback: false,
  });
});

test('T09: 写已有章号取实际草稿相对路径', () => {
  assert.deepEqual(chapterWriteTarget('写第3章', chapterDrafts), {
    intent: 'chapter.write',
    targetFilePath: '正文/第03章.md',
    planFallback: false,
  });
});

test('T09: 写下一章无具体目标，交给后端计划回退', () => {
  assert.deepEqual(planChapterSubmission('写下一章', chapterDrafts), {
    channel: 'agent',
    intent: 'chapter.write',
    targetFilePath: undefined,
    contextPaths: [],
    planFallback: true,
  });
});

test('wave1-A(a): 改写/重写/续写既有章不绑 chapter.write 目标（避免误报文件已存在）', () => {
  for (const text of ['改写第3章', '重写第3章', '续写第2章', '补写第3章']) {
    assert.equal(chapterWriteTarget(text, chapterDrafts), undefined, text);
  }
});

test('wave1-A(a): 改写类动词 + ≥2 引用章走普通 agent（intent 空、引用章作上下文）', () => {
  const plan = planChapterSubmission('重写第2章和第3章', chapterDrafts);
  assert.deepEqual(plan, {
    channel: 'agent',
    intent: undefined,
    targetFilePath: undefined,
    contextPaths: ['正文/第02章.md', '正文/第03章.md'],
    planFallback: false,
  });
});

test('wave1-A(b): 比较/提问里的「描写/写法/改动」不被误判成操作，仍走跨章通道', () => {
  const inputs = [
    '第1章和第2章的描写是否一致？',
    '对比第1章和第2章的写法',
    '第1章和第2章的时间线有没有改动？',
  ];
  for (const text of inputs) {
    const plan = planChapterSubmission(text, chapterDrafts);
    assert.equal(plan.channel, 'cross-chapter', text);
  }
});

test('T03: 润色/改写类操作同样降引用章为上下文走 agent', () => {
  const plan = planChapterSubmission('把第2章和第3章都润色一下', chapterDrafts);
  assert.equal(plan.channel, 'agent');
  if (plan.channel === 'agent') {
    assert.equal(plan.intent, undefined);
    assert.deepEqual(plan.contextPaths, ['正文/第02章.md', '正文/第03章.md']);
  }
});

test('chapterTargetPath 与「起草下一章」按钮约定一致（三位补零）', () => {
  assert.equal(chapterTargetPath(4), '正文/第004章.md');
  assert.equal(chapterTargetPath(12), '正文/第012章.md');
});

test('wave2-A: 扩写/缩写/誊写既有章不绑 chapter.write 目标', () => {
  for (const text of ['扩写第3章', '缩写第3章', '誊写第3章', '把第2章扩写一下']) {
    assert.equal(chapterWriteTarget(text, files), undefined, text);
    assert.equal(planChapterSubmission(text, files).channel, 'agent', text);
  }
});

test('wave2-A: 章号必须带「章」，写第一封信/生成第二种策略不被判成写章', () => {
  for (const text of [
    '对照第1章和第2章，主角写第一封信的时机合理吗',
    '第1章和第2章主角生成第二种策略的动机一致吗',
  ]) {
    assert.equal(planChapterSubmission(text, files).channel, 'cross-chapter', text);
  }
});

test('wave2-A: 改写下一章与否定式不产生写章意图', () => {
  for (const text of ['重写下一章', '改写下一章', '续写下一章', '不要写下一章', '先别写第3章']) {
    assert.equal(chapterWriteTarget(text, files), undefined, text);
  }
});

test('wave2-A: 中文数字章号给出目标路径（已有草稿取真实路径，否则三位补零约定）', () => {
  const plan = chapterWriteTarget('写第三章', files);
  // files 里已有 第03章 草稿：取真实草稿相对路径，而不是另造一个文件。
  assert.equal(plan?.targetFilePath, '第03章.md');
  assert.equal(chapterWriteTarget('起草第十二章', files)?.targetFilePath, '正文/第012章.md');
  assert.equal(chapterWriteTarget('写第零章', files), undefined);
});

test('wave2-A: 新章路径恒用三位补零约定（正文/ 命名硬规矩，不跟随既有章位数）', () => {
  const legacyNaming = [
    draft('第1章.md', '/proj/正文/第1章.md'),
    draft('第2章.md', '/proj/正文/第2章.md'),
  ];
  assert.equal(chapterWriteTarget('写第3章', legacyNaming)?.targetFilePath, '正文/第003章.md');
  assert.equal(chapterTargetPath(5), '正文/第005章.md');
});

test('wave2-B: 比较问句里的操作名词（修改/精简/重写…）仍走跨章检查', () => {
  for (const text of [
    '第1章和第2章的修改是否一致',
    '第1章和第2章的精简是否合适',
    '第1章和第2章的压缩比例一致吗',
    '对比第1章和第2章的重写部分',
    '第1章和第2章哪一章需要重写',
  ]) {
    assert.equal(planChapterSubmission(text, files).channel, 'cross-chapter', text);
  }
});

test('wave2-B: 否定式写章指令不夺走跨章检查，也不产生写章意图', () => {
  for (const text of [
    '先别写第1章，检查第1章和第2章是否一致',
    '暂不写第3章，先看第1章和第2章是否一致',
    '不要写第1章，看看第1章和第2章是否一致',
  ]) {
    assert.equal(planChapterSubmission(text, files).channel, 'cross-chapter', text);
  }
});

test('wave2-B: 否定词「别」只在句首算否定，分别写/特别写不被误杀', () => {
  assert.equal(chapterWriteTarget('分别写第1章', files)?.intent, 'chapter.write');
  assert.equal(chapterWriteTarget('别写第1章', files), undefined);
  assert.equal(planChapterSubmission('分别写第1章和第2章', files).channel, 'agent');
});

test('wave2-B: 中文百位章号可解析（一百/两百/一百零一）', () => {
  assert.equal(chapterWriteTarget('写第一百章', files)?.targetFilePath, '正文/第100章.md');
  assert.equal(chapterWriteTarget('写第二百章', files)?.targetFilePath, '正文/第200章.md');
  assert.equal(chapterWriteTarget('写第一百零一章', files)?.targetFilePath, '正文/第101章.md');
  assert.equal(chapterWriteTarget('写第二十三章', files)?.targetFilePath, '正文/第023章.md');
});
