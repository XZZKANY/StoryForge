import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';

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
