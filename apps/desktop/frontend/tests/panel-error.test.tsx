/**
 * 面板错误态的形状约束。
 *
 * 此前文件树 / 故事索引 / 版本历史三处都是把原始 error 字符串整条铺出来当标题，
 * 作者读到的是「无法读取文件 …: Access is denied. (os error 5)」——
 * 既不知道发生了什么，也不知道能做什么。
 *
 * 这里钉死：**人话标题 + 原始报错降级为细节 + 有重试就给按钮**。
 * 原始报错不隐藏（排障时它是唯一线索），但不许占标题位。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'vitest';

import { PanelError } from '../src/components/shell/PanelError';

const RAW = 'Access is denied. (os error 5)';

test('人话标题在前，原始报错降级为细节，两者都在场', () => {
  const html = renderToStaticMarkup(
    React.createElement(PanelError, { title: '读取项目文件失败', detail: RAW }),
  );
  assert.match(html, /读取项目文件失败/);
  assert.match(html, /Access is denied/, '原始报错必须保留——排障时是唯一线索');

  const titleAt = html.indexOf('读取项目文件失败');
  const detailAt = html.indexOf('Access is denied');
  assert.ok(titleAt < detailAt, '人话标题必须排在原始报错之前');
  assert.match(html, /data-testid="panel-error-detail"/, '原始报错走细节槽，不占标题位');
});

test('给了 onRetry 才渲染重试按钮——没有下一步就不假装有', () => {
  const withRetry = renderToStaticMarkup(
    React.createElement(PanelError, { title: '失败', onRetry: () => {} }),
  );
  assert.match(withRetry, /data-testid="panel-error-retry"/);

  const without = renderToStaticMarkup(React.createElement(PanelError, { title: '失败' }));
  assert.doesNotMatch(without, /data-testid="panel-error-retry"/);
});

test('无 detail 时不渲染空的细节行', () => {
  const html = renderToStaticMarkup(
    React.createElement(PanelError, { title: '失败', detail: null }),
  );
  assert.doesNotMatch(html, /data-testid="panel-error-detail"/);
});

test('错误态对辅助技术可见（role=alert）', () => {
  const html = renderToStaticMarkup(React.createElement(PanelError, { title: '失败' }));
  assert.match(html, /role="alert"/);
});
