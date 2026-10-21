import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  formatCrossChapterFindings,
  planChapterSubmission,
  resolveChapterRefs,
  wantsChapterWrite,
} from '../src/components/chat-window/cross-chapter';
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
    contextPaths: ['正文/第02章.md', '正文/第03章.md'],
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

// 10-20：对话里说的写章交给对话 agent（它看得到整段对话），不再绑固定写章管线与目标路径。
test('对话里写章走对话 agent，不带写章意图或目标路径', () => {
  for (const text of ['写第4章', '写第3章', '写下一章', '直接开始写第一章正文', '起草第十二章']) {
    assert.ok(wantsChapterWrite(text), text);
    assert.deepEqual(planChapterSubmission(text, chapterDrafts), {
      channel: 'agent',
      contextPaths: [],
    });
  }
});

test('wave1-A(a): 改写/重写/续写既有章不算写新章', () => {
  for (const text of ['改写第3章', '重写第3章', '续写第2章', '补写第3章']) {
    assert.equal(wantsChapterWrite(text), false, text);
  }
});

test('wave1-A(a): 改写类动词 + ≥2 引用章走普通 agent（引用章作上下文）', () => {
  const plan = planChapterSubmission('重写第2章和第3章', chapterDrafts);
  assert.deepEqual(plan, {
    channel: 'agent',
    contextPaths: ['正文/第02章.md', '正文/第03章.md'],
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
  assert.deepEqual(plan, {
    channel: 'agent',
    contextPaths: ['正文/第02章.md', '正文/第03章.md'],
  });
});

test('wave2-A: 扩写/缩写/誊写既有章不算写新章', () => {
  for (const text of ['扩写第3章', '缩写第3章', '誊写第3章', '把第2章扩写一下']) {
    assert.equal(wantsChapterWrite(text), false, text);
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
    assert.equal(wantsChapterWrite(text), false, text);
  }
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
  assert.equal(wantsChapterWrite('分别写第1章'), true);
  assert.equal(wantsChapterWrite('别写第1章'), false);
  assert.equal(planChapterSubmission('分别写第1章和第2章', files).channel, 'agent');
});
