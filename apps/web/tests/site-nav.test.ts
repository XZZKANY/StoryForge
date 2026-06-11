import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeRecentItems, type RecentItem } from '../components/site-nav/recent-items-store';
import { primaryNavLinks } from '../components/site-nav/site-nav-links';

function recentItem(
  id: string,
  type: RecentItem['type'],
  timestamp: number,
  title = id,
): RecentItem {
  return {
    id,
    type,
    title,
    href: `/${id}`,
    timestamp,
  };
}

test('primaryNavLinks 包含核心主入口路由', () => {
  const hrefs = primaryNavLinks.map((link) => link.href);
  for (const expected of [
    '/studio',
    '/retrieval',
    '/artifacts',
    '/evaluations',
    '/worldbuilding',
    '/runs',
  ]) {
    assert.ok(hrefs.includes(expected), `应包含 ${expected}`);
  }
});

test('primaryNavLinks 不引入占位路由', () => {
  const hrefs = primaryNavLinks.map((link) => link.href);
  for (const forbidden of [
    '/analytics',
    '/collaboration',
    '/commercial',
    '/workspace',
    '/quality',
    '/jobs',
    '/refinery',
  ]) {
    assert.equal(hrefs.includes(forbidden), false, `不应包含 ${forbidden}`);
  }
});

test('primaryNavLinks 每个入口都有可读标签', () => {
  for (const link of primaryNavLinks) {
    assert.ok(link.label.length > 0, `${link.href} 应有标签`);
    assert.ok(link.label.length < 30, `${link.href} 标签不应过长`);
  }
});

test('mergeRecentItems 合并真实会话和本地记录时去重、排序并截断', () => {
  const initialItems: readonly RecentItem[] = [
    recentItem('assistant-older', 'conversation', 20),
    recentItem('shared', 'conversation', 40, '服务端版本'),
  ];
  const storedItems: readonly RecentItem[] = [
    recentItem('local-newer', 'project', 80),
    recentItem('shared', 'conversation', 100, '本地重复版本'),
    ...Array.from({ length: 12 }, (_, index) =>
      recentItem(`local-${index}`, 'artifact', 70 - index),
    ),
  ];

  const merged = mergeRecentItems(initialItems, storedItems);

  assert.equal(merged.length, 10);
  assert.deepEqual(
    merged.map((item) => item.id),
    [
      'local-newer',
      'local-0',
      'local-1',
      'local-2',
      'local-3',
      'local-4',
      'local-5',
      'local-6',
      'local-7',
      'local-8',
    ],
  );
  assert.equal(
    merged.some((item) => item.title === '本地重复版本'),
    false,
  );
});
