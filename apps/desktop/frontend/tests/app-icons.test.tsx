import assert from 'node:assert/strict';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/App';

test('desktop shell renders framed chrome with icon buttons', () => {
  const html = renderToStaticMarkup(React.createElement(App, {}));

  assert.ok(html.includes('data-testid="desktop-shell"'));
  assert.ok(html.includes('data-testid="shell-activity-bar"'));
  assert.ok(html.includes('data-testid="shell-status-bar"'));
  assert.ok(html.includes('data-testid="welcome-primary-action"'));
  assert.ok(html.includes('data-testid="welcome-composer-input"'));
  // 图标按钮与无障碍隐藏标记（WelcomeWorkspace 头部 + Lucide 壳层图标）。
  // 原先断言的是 class="icon-button" —— 那个类名在 index.css 和 tailwind.config.js 里
  // 都没有定义，纯属残留字符串，断言它等于什么都没测。改断言真实存在的关闭按钮。
  assert.ok(html.includes('data-testid="welcome-close"'));
  assert.ok(html.includes('aria-hidden="true"'));
});
