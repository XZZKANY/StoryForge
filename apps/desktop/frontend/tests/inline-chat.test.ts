import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  INLINE_MINIMAL_EDIT_CONTRACT,
  buildInlineReviseInstruction,
  hunksToLineDiff,
  intraLineChangeRange,
  isInlineEditStale,
  planAnchoredInlineDiff,
  planInlineReviseWindow,
  spliceInlineReviseWindow,
  summarizeInlineDiff,
} from '../src/lib/inline-chat';

test('intraLineChangeRange 掐掉公共前后缀只留改动中段（1-based 列，endCol 独占）', () => {
  // 「铜灯只亮了一半」→「铜灯只剩一半」：改「亮了」为「剩」。公共前缀「铜灯只」(3)、后缀「一半」(2)。
  const r = intraLineChangeRange('铜灯只亮了一半', '铜灯只剩一半');
  assert.equal(r.oldStartCol, 4); // 第 4 字「亮」起
  assert.equal(r.oldEndCol, 6); // 到「了」后（覆盖「亮了」两字）
  assert.equal(r.newStartCol, 4);
  assert.equal(r.newEndCol, 5); // 新侧只「剩」一字
  // 纯插入：旧侧零宽（start===end），新侧覆盖插入段
  const ins = intraLineChangeRange('铜灯一半', '铜灯只剩一半');
  assert.equal(ins.oldStartCol, ins.oldEndCol);
  assert.ok(ins.newEndCol > ins.newStartCol);
  // 完全不同：整行都是改动区间
  const all = intraLineChangeRange('abc', 'xyz');
  assert.equal(all.oldStartCol, 1);
  assert.equal(all.oldEndCol, 4);
});

test('buildInlineReviseInstruction 带上用户意图、最小改动契约与锚定块', () => {
  const instruction = buildInlineReviseInstruction({
    anchorText: '夜雪压在檐角，铜灯只亮了一半。',
    isSelection: true,
    userInstruction: '收紧节奏，口吻更冷',
  });
  assert.ok(instruction.includes('收紧节奏，口吻更冷'));
  assert.ok(instruction.includes(INLINE_MINIMAL_EDIT_CONTRACT));
  assert.ok(instruction.includes('选中的这段'));
  assert.ok(instruction.includes('夜雪压在檐角，铜灯只亮了一半。'));
});

test('buildInlineReviseInstruction 无选区标注为光标所在行、空指令有兜底', () => {
  const instruction = buildInlineReviseInstruction({
    anchorText: '周眠掀开灰布。',
    isSelection: false,
    userInstruction: '   ',
  });
  assert.ok(instruction.includes('光标所在这一行'));
  assert.ok(instruction.includes('按下面的意图润色锚定文本。'));
});

test('buildInlineReviseInstruction 截断到后端 4000 上限', () => {
  const instruction = buildInlineReviseInstruction({
    anchorText: '锚',
    isSelection: false,
    userInstruction: '改'.repeat(5000),
  });
  assert.ok(instruction.length <= 4000);
});

test('hunksToLineDiff 单行替换给出 1-based 红标行与绿块锚点', () => {
  const before = ['甲。', '乙略硬。', '丙保留。', ''].join('\n');
  const after = ['甲。', '乙更顺。', '丙保留。', ''].join('\n');
  const hunks = hunksToLineDiff(before, after);
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0], {
    removedStartLine: 2,
    removedEndLine: 2,
    afterLineNumber: 2,
    newLines: ['乙更顺。'],
    removedLineCount: 1,
    addedLineCount: 1,
  });
});

test('hunksToLineDiff 纯新增没有红标行、绿块插在锚行之后', () => {
  const before = ['甲。', '丙。', ''].join('\n');
  const after = ['甲。', '乙新增。', '丙。', ''].join('\n');
  const hunks = hunksToLineDiff(before, after);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].removedStartLine, null);
  assert.equal(hunks[0].removedEndLine, null);
  assert.equal(hunks[0].afterLineNumber, 1);
  assert.deepEqual(hunks[0].newLines, ['乙新增。']);
  assert.equal(hunks[0].removedLineCount, 0);
  assert.equal(hunks[0].addedLineCount, 1);
});

test('hunksToLineDiff 同一行多个分段改动塌陷成一条整行替换', () => {
  // 一行内「前段…后段」两处改动、中间一段不变 → buildPatchHunks 出两个分段 hunk，
  // 归一后应去重成一条「整行替换」，绿块是完整新行而非分段片段。
  const before = '前段硬，中间不变，后段硬。';
  const after = '前段顺，中间不变，后段顺。';
  const hunks = hunksToLineDiff(before, after);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].removedStartLine, 1);
  assert.equal(hunks[0].removedEndLine, 1);
  assert.deepEqual(hunks[0].newLines, ['前段顺，中间不变，后段顺。']);
});

test('summarizeInlineDiff 汇总增删行并识别 noop', () => {
  const before = ['甲。', '乙。', ''].join('\n');
  assert.deepEqual(summarizeInlineDiff(before, before), {
    hunks: [],
    addedLines: 0,
    removedLines: 0,
    isNoop: true,
  });

  const after = ['甲。', '乙改。', ''].join('\n');
  const summary = summarizeInlineDiff(before, after);
  assert.equal(summary.isNoop, false);
  assert.equal(summary.addedLines, 1);
  assert.equal(summary.removedLines, 1);
});

test('planAnchoredInlineDiff 夹到锚定行：丢弃别处 drift、接受只写锚定处', () => {
  const before = ['甲。', '乙。', '丙。', '丁。', ''].join('\n');
  // 模型改了锚定的第 2 行，也顺手改了第 4 行（drift）。
  const after = ['甲。', '乙改。', '丙。', '丁改。', ''].join('\n');
  const plan = planAnchoredInlineDiff(before, after, { startLine: 2, endLine: 2 });
  assert.equal(plan.isNoop, false);
  assert.equal(plan.droppedOffAnchor, 1);
  assert.equal(plan.hunks.length, 1);
  assert.equal(plan.hunks[0].removedStartLine, 2);
  // clampedAfter 只应用第 2 行，第 4 行被还原。
  assert.equal(plan.clampedAfter, ['甲。', '乙改。', '丙。', '丁。', ''].join('\n'));
});

test('planAnchoredInlineDiff 模型只改了锚定处之外 → noop 且不动原文', () => {
  const before = ['甲。', '乙。', '丙。', '丁。', ''].join('\n');
  const after = ['甲。', '乙改。', '丙。', '丁改。', ''].join('\n');
  // 锚定第 3 行没被改，第 2、4 行的 drift 全丢。
  const plan = planAnchoredInlineDiff(before, after, { startLine: 3, endLine: 3 });
  assert.equal(plan.isNoop, true);
  assert.equal(plan.droppedOffAnchor, 2);
  assert.equal(plan.clampedAfter, before);
});

test('isInlineEditStale 忽略换行风格差异、只认真实内容变化', () => {
  assert.equal(isInlineEditStale('甲\r\n乙', '甲\n乙'), false);
  assert.equal(isInlineEditStale('甲\n乙', '甲\n丙'), true);
});

// —— Ctrl+K 只送锚点附近的窗口（2026-07-29）——————————————————————————
// 诊断：改一句话时请求体里装的是 `editor.getValue()`，即整章。两笔代价：BYO-key 作者
// 每次都为整章付费；模型被要求逐字重抄几千字，drift 正是从那里来——而 drift 到锚点之外
// 的改动会被 planAnchoredInlineDiff 静默丢弃，作者只看到一句「有改动被丢弃」。

/** 第 N 行的内容就是「第N段。」——行号与段号对齐，省得断言里自己算 off-by-one。 */
function longChapter(paragraphCount: number): string {
  return Array.from(
    { length: paragraphCount },
    (_, index) => `第${index + 1}段。${'字'.repeat(120)}`,
  ).join('\n');
}

test('短文件整篇送出：切窗前后逐字一致，风险只落在长章节上', () => {
  const content = '第一段。\n第二段。\n第三段。';
  const window = planInlineReviseWindow(content, { startLine: 2, endLine: 2 });

  assert.equal(window.isWholeDocument, true);
  assert.equal(window.text, content);
  assert.equal(window.startLine, 1);
  assert.equal(window.endLine, 3);
});

test('长章节只送锚点附近的窗口，且窗口一定含锚定行', () => {
  const content = longChapter(60);
  const window = planInlineReviseWindow(content, { startLine: 30, endLine: 31 });

  assert.equal(window.isWholeDocument, false);
  assert.ok(window.startLine <= 30 && window.endLine >= 31, '窗口必须罩住锚定行');
  assert.ok(window.text.length < content.length / 2, '整章没被切窗');
  assert.ok(window.text.includes('第30段。'));
  assert.equal(window.text.includes('第1段。'), false);
  assert.equal(window.text.includes('第60段。'), false);
});

test('文件开头 / 结尾的锚点不会越界', () => {
  const content = longChapter(60);

  const atTop = planInlineReviseWindow(content, { startLine: 1, endLine: 1 });
  assert.equal(atTop.startLine, 1);
  assert.ok(atTop.text.startsWith('第1段。'));

  const atBottom = planInlineReviseWindow(content, { startLine: 60, endLine: 60 });
  assert.equal(atBottom.endLine, 60);
  assert.ok(atBottom.text.endsWith('字'));

  // 越界行号夹取，不抛错。
  const beyond = planInlineReviseWindow(content, { startLine: 999, endLine: 1000 });
  assert.ok(beyond.endLine <= 60);
});

test('窗口拼回整文后，下游拿到的仍是完整文件', () => {
  const content = longChapter(60);
  const window = planInlineReviseWindow(content, { startLine: 30, endLine: 30 });

  const revisedWindow = window.text.replace('第30段。', '第30段·改。');
  const fullAfter = spliceInlineReviseWindow(content, window, revisedWindow);

  assert.ok(fullAfter.includes('第1段。'), '窗口之外的段落必须原样还在');
  assert.ok(fullAfter.includes('第60段。'));
  assert.ok(fullAfter.includes('第30段·改。'));
  assert.equal(fullAfter.split('\n').length, content.split('\n').length);

  // 拼回后走原来的夹紧路径，锚定处改动照常被识别。
  const plan = planAnchoredInlineDiff(content, fullAfter, { startLine: 30, endLine: 30 });
  assert.equal(plan.isNoop, false);
  assert.equal(plan.droppedOffAnchor, 0);
  assert.ok(plan.clampedAfter.includes('第30段·改。'));
});

test('模型在窗口内跑到锚点之外时，拼回后仍被夹掉', () => {
  const content = longChapter(60);
  const window = planInlineReviseWindow(content, { startLine: 30, endLine: 30 });

  const drifted = window.text
    .replace('第30段。', '第30段·改。')
    .replace('第28段。', '第28段·乱改。');
  const fullAfter = spliceInlineReviseWindow(content, window, drifted);
  const plan = planAnchoredInlineDiff(content, fullAfter, { startLine: 30, endLine: 30 });

  assert.ok(plan.clampedAfter.includes('第30段·改。'));
  assert.ok(plan.clampedAfter.includes('第28段。'), 'drift 必须被丢弃');
  assert.equal(plan.clampedAfter.includes('第28段·乱改。'), false);
  assert.ok(plan.droppedOffAnchor > 0);
});

test('切窗时指令必须告诉模型这是节选，否则它会给节选补开头结尾', () => {
  const excerpt = buildInlineReviseInstruction({
    anchorText: '这一句',
    isSelection: true,
    userInstruction: '写紧一点',
    isExcerpt: true,
  });
  assert.ok(excerpt.includes('节选'));
  assert.ok(excerpt.includes(INLINE_MINIMAL_EDIT_CONTRACT));

  const whole = buildInlineReviseInstruction({
    anchorText: '这一句',
    isSelection: true,
    userInstruction: '写紧一点',
  });
  assert.equal(whole.includes('节选'), false);
});
