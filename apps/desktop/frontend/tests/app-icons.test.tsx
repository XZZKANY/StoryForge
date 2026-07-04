import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/App';

test('desktop shell renders framed chrome with icon buttons', () => {
  const html = renderToStaticMarkup(React.createElement(App, {}));

  assert.ok(html.includes('data-testid="desktop-shell"'));
  assert.ok(html.includes('data-testid="shell-activity-bar"'));
  assert.ok(html.includes('data-testid="shell-status-bar"'));
  assert.ok(html.includes('data-testid="add-project-btn"'));
  assert.ok(html.includes('data-testid="welcome-primary-action"'));
  assert.ok(html.includes('data-testid="welcome-composer-input"'));
  // 图标按钮与无障碍隐藏标记（WelcomeWorkspace 头部 + Lucide 壳层图标）。
  assert.ok(html.includes('icon-button'));
  assert.ok(html.includes('aria-hidden="true"'));
});
