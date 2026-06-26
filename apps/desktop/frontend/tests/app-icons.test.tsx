import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/App';

test('desktop shell renders polished icon buttons', () => {
  const html = renderToStaticMarkup(React.createElement(App, {}));

  assert.ok(html.includes('data-testid="desktop-shell"'));
  assert.ok(html.includes('data-testid="add-project-btn"'));
  assert.ok(html.includes('data-testid="welcome-primary-action"'));
  assert.ok(html.includes('icon-button'));
  assert.ok(html.includes('icon-badge'));
  assert.ok(html.includes('aria-hidden="true"'));
  assert.ok(html.includes('缺少密钥引用'));
  assert.equal(html.includes('模型服务未检测'), false);
});
