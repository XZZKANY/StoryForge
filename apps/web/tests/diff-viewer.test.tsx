import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RepairDiffViewer } from '../components/diff-viewer/RepairDiffViewer';

test('RepairDiffViewer 渲染相同文本不显示新增或删除', () => {
  const html = renderToStaticMarkup(
    React.createElement(RepairDiffViewer, {
      originalText: '一致的文本',
      revisedText: '一致的文本',
    }),
  );
  assert.ok(html.includes('修订差异'));
  assert.ok(html.includes('新增 0 行'));
  assert.ok(html.includes('删除 0 行'));
});

test('RepairDiffViewer 渲染新增段时输出 add 数据属性', () => {
  const html = renderToStaticMarkup(
    React.createElement(RepairDiffViewer, {
      originalText: '第一行\n',
      revisedText: '第一行\n第二行\n',
    }),
  );
  assert.ok(html.includes('data-segment-type="add"'), '应该包含新增段标记');
  assert.ok(html.includes('新增 1 行'));
});

test('RepairDiffViewer 渲染删除段时输出 del 数据属性', () => {
  const html = renderToStaticMarkup(
    React.createElement(RepairDiffViewer, {
      originalText: '第一行\n第二行\n',
      revisedText: '第一行\n',
    }),
  );
  assert.ok(html.includes('data-segment-type="del"'), '应该包含删除段标记');
  assert.ok(html.includes('删除 1 行'));
});

test('RepairDiffViewer 暴露原文与修订全文备选展示', () => {
  const html = renderToStaticMarkup(
    React.createElement(RepairDiffViewer, {
      originalText: 'foo',
      revisedText: 'bar',
    }),
  );
  assert.ok(html.includes('查看原文与修订全文'));
  assert.ok(html.includes('原文'));
  assert.ok(html.includes('修订文本'));
});
