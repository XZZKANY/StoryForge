import assert from 'node:assert/strict';
import { test } from 'vitest';

import { planBatchPublish, type BatchChapterInput } from '../src/features/publish/model';

function ch(name: string, title: string, charCount: number): BatchChapterInput {
  return { path: `D:/novels/x/${name}`, name, title, charCount };
}

test('批量计划：线上已发去重 + 字数下限跳过', () => {
  const chapters = [
    ch('001.md', '第1章 觉醒', 1500),
    ch('002.md', '第2章 试炼', 1200),
    ch('003.md', '第3章 短', 300),
  ];
  const plan = planBatchPublish({
    chapters,
    onlineTitles: ['第1章 觉醒'], // 归一后与本地匹配
    minChars: 1000,
  });
  assert.equal(plan.dedupAvailable, true);
  assert.equal(plan.publishCount, 1); // 只剩第2章
  assert.equal(plan.skipOnlineCount, 1);
  assert.equal(plan.skipShortCount, 1);

  const c1 = plan.items.find((i) => i.name === '001.md')!;
  const c2 = plan.items.find((i) => i.name === '002.md')!;
  const c3 = plan.items.find((i) => i.name === '003.md')!;
  assert.equal(c1.alreadyOnline, true);
  assert.equal(c1.skip, true);
  assert.equal(c1.skipReason, '已在线');
  assert.equal(c2.skip, false);
  assert.equal(c3.tooShort, true);
  assert.equal(c3.skipReason, '不足1000字');
});

test('批量计划：拿不到线上标题则不去重，只按字数', () => {
  const chapters = [ch('001.md', '第1章', 2000), ch('002.md', '第2章', 500)];
  const plan = planBatchPublish({ chapters, onlineTitles: [], minChars: 1000 });
  assert.equal(plan.dedupAvailable, false);
  assert.equal(plan.publishCount, 1);
  assert.equal(plan.skipOnlineCount, 0);
  assert.equal(plan.skipShortCount, 1);
  assert.equal(plan.items[0].alreadyOnline, false);
});
