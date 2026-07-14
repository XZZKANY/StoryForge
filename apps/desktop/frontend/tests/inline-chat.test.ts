import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  INLINE_MINIMAL_EDIT_CONTRACT,
  buildInlineReviseInstruction,
  hunksToLineDiff,
  isInlineEditStale,
  summarizeInlineDiff,
} from '../src/lib/inline-chat';

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

test('isInlineEditStale 忽略换行风格差异、只认真实内容变化', () => {
  assert.equal(isInlineEditStale('甲\r\n乙', '甲\n乙'), false);
  assert.equal(isInlineEditStale('甲\n乙', '甲\n丙'), true);
});
