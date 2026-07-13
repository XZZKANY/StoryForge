import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/App';
import { AppDialogHost, type AppDialogState } from '../src/components/app/AppDialog';

// 壳层护栏：固化固定三栏「编辑器中枢」结构。
// renderToStaticMarkup 不跑 effects，projects 在 SSR 时为空 → 无项目态：
// 中栏渲染 WelcomeWorkspace（起始输入舱），右栏 Agent 面板不挂载。

const appSource = readFileSync('src/App.tsx', 'utf8');
const assistantPanelSource = readFileSync('src/components/shell/AssistantPanelFrame.tsx', 'utf8');
const commandPaletteSource = readFileSync('src/components/CommandPalette.tsx', 'utf8');
const shellSource = `${appSource}\n${assistantPanelSource}`;

function renderApp() {
  return renderToStaticMarkup(React.createElement(App, {}));
}

test('App 壳层挂载 desktop-shell 容器与三栏框架标记', () => {
  const html = renderApp();
  assert.match(html, /data-testid="desktop-shell"/);
  assert.match(html, /data-layout-mode=/);
  // Q4 布局三态默认平衡（编辑 + 右栏对话）。
  assert.match(html, /data-layout-focus="balanced"/);
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

test('App 活动栏 Q8 精简为 文件/搜索/设置，会话与质检图标已撤走', () => {
  const html = renderApp();
  assert.match(html, /data-testid="activity-explorer"/);
  assert.match(html, /data-testid="activity-search"/);
  assert.match(html, /data-testid="activity-settings"/);
  // 会话移入右栏对话头（Q5）、质检收到状态栏观测芯片，二者不再是活动栏图标。
  assert.doesNotMatch(html, /data-testid="activity-sessions"/);
  assert.doesNotMatch(html, /data-testid="activity-qa"/);
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
    assert.ok(shellSource.includes(marker), `桌面壳层源文本缺失结构符号：${marker}`);
  }
});

test('App 中栏和右栏锁定滚动边界，长稿不能把状态栏或 Agent 栏顶走', () => {
  const requiredLayoutGuards = [
    'className="min-h-0 flex-1 overflow-hidden"',
    "settingsVisible ? 'hidden' : 'h-full'",
    'min-h-0 overflow-hidden bg-background',
    // Q4 布局三态后 Agent 栏宽度按 wide 条件化，但平衡宽 + 溢出护栏仍在（长稿不能顶走状态栏）。
    'w-[384px] flex-shrink-0',
    'flex-col overflow-hidden border-l border-border bg-panel',
  ];
  for (const guard of requiredLayoutGuards) {
    assert.ok(shellSource.includes(guard), `桌面壳层缺少长稿布局护栏：${guard}`);
  }
});

test('App 切换文件保留多标签 buffer，仅关闭或离开项目时确认 dirty', () => {
  assert.match(appSource, /const \[openFiles, setOpenFiles\]/);
  assert.match(appSource, /const \[dirtyFiles, setDirtyFiles\]/);
  assert.match(appSource, /retainedFilePaths=\{retainedEditorFiles\}/);
  assert.match(appSource, /dirtyFiles=\{dirtyFiles\}/);
  assert.match(appSource, /confirmDiscardFiles\(\[path\], '关闭文件'\)/);
  assert.match(appSource, /confirmDiscardFiles\(openFiles, '切换项目'\)/);
  assert.doesNotMatch(appSource, /confirmDiscardDirtyEditor/);
});

test('打开设置只隐藏 Editor，不卸载多文件 buffer cache', () => {
  assert.match(appSource, /hidden=\{settingsVisible\}/);
  assert.match(appSource, /\{settingsVisible && \([\s\S]{0,500}<SettingsView[\s\S]{0,900}<Editor/);
  assert.doesNotMatch(appSource, /settingsVisible \? \([\s\S]{0,500}<SettingsView/);
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

test('长消息弹窗限制在视口内，正文可滚动且操作按钮保持可见', () => {
  const dialog: AppDialogState = {
    kind: 'alert',
    title: 'Canon 事实卡已刷新（参考信号）',
    message: Array.from({ length: 20 }, (_, index) => `派生事实 ${index + 1}`).join('\n'),
    confirmLabel: '知道了',
    resolve: () => {},
  };
  const html = renderToStaticMarkup(
    React.createElement(AppDialogHost, {
      dialog,
      onClose: () => {},
      onPromptValueChange: () => {},
    }),
  );

  assert.match(html, /max-h-\[calc\(100vh-2rem\)\]/);
  assert.match(html, /<p[^>]*overflow-y-auto[^>]*data-testid="app-dialog-message"/);
  assert.match(html, /<div[^>]*shrink-0[^>]*data-testid="app-dialog-actions"/);
});

test('Canon 刷新成功后同步刷新项目文件树', () => {
  assert.match(
    appSource,
    /executeIdeCommand\('canon\.refresh',[\s\S]{0,900}setProjectRefreshVersion\(\(version\) => version \+ 1\)/,
  );
});

test('Canon 刷新先保存当前脏稿并失效目录缓存', () => {
  assert.match(
    appSource,
    /dirtyFiles\.has\(currentFile\)[\s\S]{0,180}flushActiveEditorToDisk\(currentFile\)[\s\S]{0,500}executeIdeCommand\('canon\.refresh'/,
  );
  assert.match(
    appSource,
    /executeIdeCommand\('canon\.refresh'[\s\S]{0,900}invalidateFileSystemCache\(activeProject\)/,
  );
});

test('命令面板在矮窗口内限高并让结果列表内部滚动', () => {
  assert.match(commandPaletteSource, /max-h-\[calc\(100vh-2rem\)\]/);
  assert.match(commandPaletteSource, /min-h-0 max-h-80 flex-1 overflow-y-auto/);
});
