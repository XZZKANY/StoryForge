import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';

import {
  accumulateDailyProgress,
  localDateKey,
  readDailyProgress,
  recordDailyProgress,
  writebackDelta,
} from '../src/lib/daily-progress';

beforeEach(() => {
  localStorage.clear();
});

test('日期键取本地日历日——用 UTC 会把午夜前后的写作算到隔壁天', () => {
  // 2026-07-26 23:30 本地时间：toISOString 会给出 07-26T15:30Z 或 07-27，取决于时区偏移。
  const nearMidnight = new Date(2026, 6, 26, 23, 30, 0);
  assert.equal(localDateKey(nearMidnight), '2026-07-26');
  assert.equal(localDateKey(new Date(2026, 0, 5, 0, 1, 0)), '2026-01-05');
});

test('跨天自动归零，不把昨天的产出算进今天', () => {
  const yesterday = { date: '2026-07-25', chars: 4200 };
  assert.deepEqual(accumulateDailyProgress(yesterday, '2026-07-26', 300), {
    date: '2026-07-26',
    chars: 300,
  });
  assert.deepEqual(accumulateDailyProgress(yesterday, '2026-07-25', 300), {
    date: '2026-07-25',
    chars: 4500,
  });
  assert.deepEqual(accumulateDailyProgress(null, '2026-07-26', 120), {
    date: '2026-07-26',
    chars: 120,
  });
});

test('删稿的负增量如实相减，不夹到 0（夹了就把「今天净删 2000 字」显示成 0）', () => {
  assert.equal(writebackDelta('第一章 开场白', '第一章'), -3);
  assert.deepEqual(
    accumulateDailyProgress({ date: '2026-07-26', chars: 500 }, '2026-07-26', -800),
    {
      date: '2026-07-26',
      chars: -300,
    },
  );
});

test('增量按网文口径（非空白字符），空白改动不计字', () => {
  assert.equal(writebackDelta('他走了', '他 走 了'), 0);
  assert.equal(writebackDelta('', '他走了。'), 4);
  assert.equal(writebackDelta('他走了。', '他走了。她也走了。'), 5);
});

test('账本按项目隔离，A 项目的日更不会漏到 B 项目', () => {
  const now = new Date(2026, 6, 26, 10, 0, 0);
  recordDailyProgress('D:\\连载\\甲书', 800, now);
  recordDailyProgress('D:\\连载\\乙书', 150, now);

  assert.equal(readDailyProgress('D:\\连载\\甲书', now).chars, 800);
  assert.equal(readDailyProgress('D:\\连载\\乙书', now).chars, 150);
});

test('多次写回累加；读到隔天的存档时返回今日 0 而不是昨天的数', () => {
  const today = new Date(2026, 6, 26, 9, 0, 0);
  recordDailyProgress('D:\\连载\\甲书', 500, today);
  recordDailyProgress('D:\\连载\\甲书', 700, today);
  assert.equal(readDailyProgress('D:\\连载\\甲书', today).chars, 1200);

  const tomorrow = new Date(2026, 6, 27, 9, 0, 0);
  const fresh = readDailyProgress('D:\\连载\\甲书', tomorrow);
  assert.equal(fresh.chars, 0);
  assert.equal(fresh.date, '2026-07-27');
});

test('未打开项目时不写盘，也不炸', () => {
  const now = new Date(2026, 6, 26, 10, 0, 0);
  assert.equal(recordDailyProgress(null, 900, now).chars, 900);
  assert.equal(readDailyProgress(null, now).chars, 0);
  assert.equal(localStorage.length, 0);
});

test('存档损坏时当作没有账本，不让一条坏 JSON 卡死状态栏', () => {
  const now = new Date(2026, 6, 26, 10, 0, 0);
  localStorage.setItem('storyforge:daily-progress:D:\\连载\\甲书', '{ 不是 JSON');
  assert.equal(readDailyProgress('D:\\连载\\甲书', now).chars, 0);

  localStorage.setItem('storyforge:daily-progress:D:\\连载\\乙书', '{"date":"2026-07-26"}');
  assert.equal(readDailyProgress('D:\\连载\\乙书', now).chars, 0);
});
