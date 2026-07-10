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

test('App 中栏和右栏锁定滚动边界，长稿不能把状态栏或 Agent 栏顶走', () => {
  const requiredLayoutGuards = [
    'className="min-h-0 flex-1 overflow-hidden"',
    'className="h-full min-h-0 overflow-hidden bg-background"',
    'className="flex min-h-0 w-[384px] flex-shrink-0 flex-col overflow-hidden',
  ];
  for (const guard of requiredLayoutGuards) {
    assert.ok(appSource.includes(guard), `App.tsx 缺少长稿布局护栏：${guard}`);
  }
});

test('App 在替换编辑器内容前统一经过 dirty discard guard', () => {
  const requiredDirtyGuards = [
    'onDirtyChange={handleEditorDirtyChange}',
    "actionLabel = '打开其他文件'",
    'confirmDiscardDirtyEditor(path, actionLabel)',
    "confirmDiscardDirtyEditor(path, '预览其他文件')",
    "confirmDiscardDirtyEditor(null, '切换项目')",
    "confirmDiscardDirtyEditor(null, '关闭文件')",
    "confirmDiscardDirtyEditor(null, '关闭预览文件')",
    "openFile(filePath, '打开新文件')",
    "confirmDiscardDirtyEditor(null, '移除当前项目')",
    "confirmDiscardDirtyEditor(currentFile, '切换到已固定文件')",
    "confirmDiscardDirtyEditor(previewFile, '切换到预览文件')",
    "confirmDiscardDirtyEditor(null, '打开设置')",
  ];
  for (const guard of requiredDirtyGuards) {
    assert.ok(appSource.includes(guard), `App.tsx 缺少 dirty 切换护栏：${guard}`);
  }
  assert.match(
    appSource,
    /key === ','[\s\S]{0,120}void openSettings\(\)/,
    'Ctrl+, 必须复用 openSettings dirty guard，不能直接卸载编辑器',
  );
  assert.equal(
    appSource.includes('if (confirmed) setDirtyEditorFile(null)'),
    false,
    '确认函数不能在替换动作真正提交前清掉 dirty guard',
  );
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
