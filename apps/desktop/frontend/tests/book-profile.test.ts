/**
 * 作品档案的红线：`.storyforge/book.json` 是作者随手能用编辑器打开手改的文件。
 * 因此解析必须容错到底——坏 JSON、少字段、类型写错，一律降级成默认值，
 * 绝不让左栏因为一个多余的逗号就打空。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  bookGoalProgress,
  displayBookTitle,
  emptyBookProfile,
  formatWordCount,
  normalizeTags,
  parseBookProfile,
  serializeBookProfile,
} from '../src/lib/book-profile';

test('坏 JSON 与非对象一律降级成空档案，不抛错', () => {
  for (const raw of ['', '{', 'null', '[]', '"末世吞噬"', '42']) {
    assert.deepEqual(parseBookProfile(raw), emptyBookProfile());
  }
});

test('字段类型写错时逐字段降级，不整份丢弃', () => {
  const profile = parseBookProfile(
    JSON.stringify({
      title: 42,
      synopsis: '一场蓝色雨后。',
      tags: '末世',
      cover: '   ',
      wordGoal: -100,
    }),
  );
  // 只有 title/tags/cover/wordGoal 坏了，synopsis 必须留下。
  assert.equal(profile.synopsis, '一场蓝色雨后。');
  assert.equal(profile.title, '');
  assert.deepEqual(profile.tags, []);
  assert.equal(profile.cover, null);
  assert.equal(profile.wordGoal, 0);
});

test('wordGoal 取整且拒绝零负值', () => {
  assert.equal(parseBookProfile('{"wordGoal":1000000.7}').wordGoal, 1000000);
  assert.equal(parseBookProfile('{"wordGoal":0}').wordGoal, 0);
  assert.equal(parseBookProfile('{"wordGoal":"100万"}').wordGoal, 0);
});

test('题材去重、剥井号、上限 8 个', () => {
  assert.deepEqual(normalizeTags([' 末世 ', '#系统', '末世', '', 7, '系统']), ['末世', '系统']);
  assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => `题材${i}`)).length, 8);
  assert.deepEqual(normalizeTags('末世'), []);
});

test('书名为空回落到目录名，显式起名后不再跟着目录走', () => {
  const profile = emptyBookProfile();
  assert.equal(displayBookTitle(profile, 'D:\\连载\\末世吞噬'), '末世吞噬');
  assert.equal(displayBookTitle(profile, '/home/w/books/雪夜斩/'), '雪夜斩');
  assert.equal(displayBookTitle({ ...profile, title: '另一个名字' }, 'D:\\连载\\末世吞噬'), '另一个名字');
});

test('序列化字段序稳定且以换行收尾，往返不丢信息', () => {
  const profile = {
    ...emptyBookProfile(),
    title: '末世吞噬',
    synopsis: '一场蓝色雨后。',
    tags: ['末世', '系统'],
    cover: 'cover.jpg',
    wordGoal: 1000000,
  };
  const text = serializeBookProfile(profile);
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(Object.keys(JSON.parse(text)), [
    'version',
    'title',
    'synopsis',
    'tags',
    'cover',
    'wordGoal',
  ]);
  assert.deepEqual(parseBookProfile(text), profile);
});

test('未设目标返回 null（UI 据此整段不渲染，而不是画一条永远 0% 的条）', () => {
  assert.equal(bookGoalProgress(50000, 0), null);
  assert.equal(bookGoalProgress(50000, 100000), 0.5);
  // 超额封顶到 1，进度条不会溢出容器。
  assert.equal(bookGoalProgress(200000, 100000), 1);
});

test('万字口径只在过万时启用', () => {
  assert.equal(formatWordCount(9999), '9,999 字');
  assert.equal(formatWordCount(124000), '12.4 万字');
});
