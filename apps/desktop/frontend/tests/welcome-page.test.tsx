import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/App';
import { DEFAULT_APP_SETTINGS, sanitizeAppSettings } from '../src/lib/user-settings';

// v3 原型欢迎页护栏：无项目启动落到「启动 / 上手 / 最近」两栏欢迎页（SSR 不跑 effects，
// projects 为空 → 无项目态）。固化两栏结构、四张引导卡、可关页签与启动开关。

function renderApp() {
  return renderToStaticMarkup(React.createElement(App, {}));
}

test('无项目启动渲染 v3 欢迎页：品牌 + 启动/上手/最近 两栏', () => {
  const html = renderApp();
  assert.match(html, /data-testid="welcome-workspace"/);
  assert.match(html, /可验证的长篇创作流水线 · 一句话就能开新书/);
  assert.match(html, /启动/);
  assert.match(html, /上手/);
  assert.match(html, /最近/);
  // 启动列：一句话开书 composer + 三个入口（含快捷键）。
  assert.match(html, /data-testid="welcome-composer-input"/);
  assert.match(html, /data-testid="welcome-primary-action"/);
  assert.match(html, /打开项目/);
  assert.match(html, /新建文件/);
  assert.match(html, /命令面板/);
  assert.match(html, /Ctrl O/);
  assert.match(html, /Ctrl P/);
});

test('欢迎页上手四张引导卡文案齐全', () => {
  const html = renderApp();
  assert.match(html, /配置模型服务，连接真实 LLM/);
  assert.match(html, /打开样例项目「雪夜斩」/);
  assert.match(html, /快捷键速查/);
  assert.match(html, /了解 StoryForge/);
});

test('欢迎页可关（页签 ×）+「启动时显示欢迎页」开关默认勾选', () => {
  const html = renderApp();
  assert.match(html, /data-testid="welcome-close"/);
  assert.match(html, /data-testid="welcome-startup-toggle"/);
  assert.match(html, /启动时显示欢迎页/);
  // 偏好默认为「开」，旧配置缺字段回落为「开」，显式 false 保留。
  assert.equal(DEFAULT_APP_SETTINGS.showWelcomeOnStartup, true);
  assert.equal(sanitizeAppSettings({}).showWelcomeOnStartup, true);
  assert.equal(sanitizeAppSettings({ showWelcomeOnStartup: false }).showWelcomeOnStartup, false);
});

test('命令面板暴露「显示欢迎页」重开入口（无项目时）', () => {
  const paletteSource = readFileSync('src/components/CommandPalette.tsx', 'utf8');
  assert.match(paletteSource, /id: 'show-welcome'/);
  assert.match(paletteSource, /显示欢迎页/);
  assert.match(paletteSource, /if \(!projectPath\)/);
});
