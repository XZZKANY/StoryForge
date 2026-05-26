import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { ErrorCard } from '../components/ui/ErrorCard';

test('LoadingSkeleton 默认渲染 aria-busy 状态', () => {
  const html = renderToStaticMarkup(React.createElement(LoadingSkeleton, {}));
  assert.ok(html.includes('aria-busy="true"'));
  assert.ok(html.includes('正在加载'));
  assert.ok(html.includes('data-testid="loading-skeleton"'));
});

test('LoadingSkeleton 支持自定义行数与标签', () => {
  const html = renderToStaticMarkup(
    React.createElement(LoadingSkeleton, { lines: 5, label: '正在加载工件列表' }),
  );
  assert.ok(html.includes('正在加载工件列表'));
  const skeletonLineCount = (html.match(/animate-pulse/g) ?? []).length;
  assert.equal(skeletonLineCount, 5);
});

test('LoadingSkeleton 对非法行数回退到 1 行', () => {
  const html = renderToStaticMarkup(React.createElement(LoadingSkeleton, { lines: 0 }));
  const skeletonLineCount = (html.match(/animate-pulse/g) ?? []).length;
  assert.equal(skeletonLineCount, 1);
});

test('ErrorCard 渲染默认标题与消息', () => {
  const html = renderToStaticMarkup(React.createElement(ErrorCard, { message: '后端 503' }));
  assert.ok(html.includes('读取失败'));
  assert.ok(html.includes('后端 503'));
  assert.ok(html.includes('role="status"'));
});

test('ErrorCard 支持自定义标题与动作', () => {
  const html = renderToStaticMarkup(
    React.createElement(ErrorCard, {
      title: '同步失败',
      message: '请稍后再试',
      action: React.createElement('button', null, '重试'),
    }),
  );
  assert.ok(html.includes('同步失败'));
  assert.ok(html.includes('请稍后再试'));
  assert.ok(html.includes('重试'));
});
