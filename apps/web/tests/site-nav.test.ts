import assert from 'node:assert/strict';
import { test } from 'node:test';

import { primaryNavLinks } from '../components/site-nav/site-nav-links';

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
