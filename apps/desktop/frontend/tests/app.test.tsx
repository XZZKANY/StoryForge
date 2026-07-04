import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/App';

// 壳层护栏：固化固定三栏「编辑器中枢」结构。
// renderToStaticMarkup 不跑 effects，projects 在 SSR 时为空 → 无项目态：
// 中栏渲染 WelcomeWorkspace（起始输入舱），右栏 Agent 面板不挂载。

const appSource = readFileSync('src/App.tsx', 'utf8');

function renderApp() {
  return renderToStaticMarkup(React.createElement(App, {}));
}

test('App 壳层挂载 desktop-shell 容器与三栏框架标记', () => {
  const html = renderApp();
  assert.match(html, /data-testid="desktop-shell"/);
  assert.match(html, /data-layout-mode=/);
  assert.match(html, /data-tauri-runtime=/);
  assert.match(html, /data-testid="shell-titlebar"/);
  assert.match(html, /data-testid="shell-activity-bar"/);
  assert.match(html, /data-testid="shell-side-panel"/);
  assert.match(html, /data-testid="shell-center"/);
  assert.match(html, /data-testid="shell-status-bar"/);
});

test('App 无项目时中栏渲染 WelcomeWorkspace 与打开项目入口，右栏不挂载', () => {
  const html = renderApp();
  assert.match(html, /data-testid="welcome-workspace"/);
  assert.match(html, /data-testid="welcome-primary-action"/);
  assert.match(html, /data-testid="welcome-composer-input"/);
  // 无项目：Agent 面板与编辑器均不挂载。
  assert.equal(html.includes('data-testid="assistant-panel"'), false);
  assert.equal(html.includes('data-testid="editor-panel"'), false);
});

test('App 无项目时侧面板资源管理器暴露空态与打开项目按钮', () => {
  const html = renderApp();
  assert.match(html, /data-testid="explorer-empty"/);
  assert.match(html, /data-testid="add-project-btn"/);
});

test('App 活动栏暴露故事视图与设置入口', () => {
  const html = renderApp();
  assert.match(html, /data-testid="activity-explorer"/);
  assert.match(html, /data-testid="activity-settings"/);
});

test('源文本保留三栏壳层结构符号（中/右对调后的编辑器中枢）', () => {
  const appMarkers = [
    'data-testid="desktop-shell"',
    'Titlebar',
    'ActivityBar',
    'SidePanel',
    'StatusBar',
    'Editor', // 中栏正文 C 位
    'ChatWindow', // 右栏 Agent 面板
    'data-testid="assistant-panel"',
    'data-testid="editor-panel"',
  ];
  for (const marker of appMarkers) {
    assert.ok(appSource.includes(marker), `App.tsx 源文本缺失壳层结构符号：${marker}`);
  }
});

test('App.tsx 不残留旧布局引擎与 Web legacy 路由入口', () => {
  const staleMarkers = [
    'DynamicIDELayout',
    'RightWorkspace',
    'CodexSidebar',
    '/studio',
    '/retrieval',
    '/runs',
    '/artifacts',
    '/evaluations',
    'legacy:',
  ];
  for (const marker of staleMarkers) {
    assert.equal(
      appSource.includes(marker),
      false,
      `App.tsx 不应残留旧布局/Web legacy 入口：${marker}`,
    );
  }
});
