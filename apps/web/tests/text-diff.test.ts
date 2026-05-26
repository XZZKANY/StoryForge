import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffLines, summarizeDiff } from '../lib/text-diff';

test('diffLines 对相同文本返回单一 equal 段', () => {
  const segments = diffLines('hello world', 'hello world');
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, 'equal');
  assert.equal(segments[0].text, 'hello world');
});

test('diffLines 对空文本返回空数组', () => {
  const segments = diffLines('', '');
  assert.deepEqual(segments, []);
});

test('diffLines 标识新增行', () => {
  const segments = diffLines('A\nB\n', 'A\nB\nC\n');
  const addSegments = segments.filter((s) => s.type === 'add');
  assert.equal(addSegments.length, 1);
  assert.equal(addSegments[0].text, 'C\n');
});

test('diffLines 标识删除行', () => {
  const segments = diffLines('A\nB\nC\n', 'A\nC\n');
  const delSegments = segments.filter((s) => s.type === 'del');
  assert.equal(delSegments.length, 1);
  assert.equal(delSegments[0].text, 'B\n');
});

test('diffLines 同时标识新增与删除', () => {
  const segments = diffLines('alpha\nbeta\n', 'alpha\ngamma\n');
  const types = segments.map((s) => s.type).sort();
  assert.ok(types.includes('add'));
  assert.ok(types.includes('del'));
  assert.ok(types.includes('equal'));
});

test('summarizeDiff 统计新增与删除行数', () => {
  const segments = diffLines('A\nB\nC\n', 'A\nC\nD\n');
  const stats = summarizeDiff(segments);
  assert.ok(stats.additions >= 1, '至少一行新增');
  assert.ok(stats.deletions >= 1, '至少一行删除');
});

test('diffLines 连续相同类型自动合并', () => {
  const segments = diffLines('A\nB\nC\n', 'X\nY\nZ\n');
  const consecutiveSame = segments.some((segment, index, all) => {
    const next = all[index + 1];
    return next ? segment.type === next.type : false;
  });
  assert.equal(consecutiveSame, false, '相邻段类型必须不同');
});
