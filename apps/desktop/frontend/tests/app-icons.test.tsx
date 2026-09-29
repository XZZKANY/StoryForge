import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/App';

test('desktop shell renders framed chrome with icon buttons', () => {
  const html = renderToStaticMarkup(React.createElement(App, {}));

  assert.ok(html.includes('data-testid="desktop-shell"'));
  assert.ok(html.includes('data-testid="shell-activity-bar"'));
  assert.ok(!html.includes('data-testid="shell-status-bar"'));
  assert.ok(html.includes('data-testid="library-open-project"'));
  assert.ok(html.includes('data-testid="library-new-project"'));
  // 图标隐藏于辅助技术，作品库入口有真实文字而不是匿名图标。
  assert.ok(html.includes('data-testid="titlebar-library"'));
  assert.ok(html.includes('aria-hidden="true"'));
});
