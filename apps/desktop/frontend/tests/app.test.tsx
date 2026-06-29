import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/App';

// G3 护栏：App() 主组件此前只有静态快照（app-icons），缺少布局/交互结构护栏。
// renderToStaticMarkup 不跑 effects，projects 在 SSR 时为空 → 渲染 WelcomeWorkspace。
// 本测试固化壳层结构（拆分 C2 前移护栏）+ 镜像 ide-shell.spec.ts 的源文本断言。

const appSource = readFileSync('src/App.tsx', 'utf8');
const rightWorkspaceSource = readFileSync('src/components/app/RightWorkspace.tsx', 'utf8');

function renderApp() {
  return renderToStaticMarkup(React.createElement(App, {}));
}

test('App 壳层挂载 desktop-shell 容器与 data-layout-mode 标记', () => {
  const html = renderApp();
  assert.match(html, /data-testid="desktop-shell"/);
  assert.match(html, /data-layout-mode=/);
  assert.match(html, /data-tauri-runtime=/);
});

test('App 无项目时渲染 WelcomeWorkspace 与打开项目入口', () => {
  const html = renderApp();
  assert.match(html, /data-testid="welcome-workspace"/);
  assert.match(html, /data-testid="welcome-primary-action"/);
  assert.match(html, /data-testid="welcome-show-workbench"/);
});

test('App 壳层暴露项目库入口与新增项目按钮', () => {
  const html = renderApp();
  assert.match(html, /data-testid="add-project-btn"/);
  assert.match(html, /data-testid="project-library-list"/);
  assert.match(html, /data-testid="toggle-project-library"/);
});

test('源文本保留 ide-shell.spec.ts 依赖的壳层结构符号（拆分 C2 前移护栏）', () => {
  // C2 拆分后，部分壳层符号随子组件移入 src/components/app/*：
  //   - App.tsx 仍保留：desktop-shell、各子组件名（import/JSX 引用）、assistant-panel
  //   - RightWorkspace.tsx 持有：editor-panel、file-tree-panel（e2e ide-shell.spec 依赖）
  const appMarkers = [
    'data-testid="desktop-shell"',
    'WindowMenu',
    'CodexSidebar',
    'AgentWorkspace',
    'RightWorkspace',
    'DynamicIDELayout',
    'data-testid="assistant-panel"',
  ];
  const rightWorkspaceMarkers = [
    'data-testid="editor-panel"',
    'data-testid="file-tree-panel"',
  ];
  for (const marker of appMarkers) {
    assert.ok(
      appSource.includes(marker),
      `App.tsx 源文本缺失壳层结构符号：${marker}`,
    );
  }
  for (const marker of rightWorkspaceMarkers) {
    assert.ok(
      rightWorkspaceSource.includes(marker),
      `RightWorkspace.tsx 源文本缺失壳层结构符号：${marker}`,
    );
  }
});

test('App.tsx 不残留 Web legacy 路由入口', () => {
  const legacyMarkers = ['/studio', '/retrieval', '/runs', '/artifacts', '/evaluations', 'legacy:'];
  for (const marker of legacyMarkers) {
    assert.equal(
      appSource.includes(marker),
      false,
      `App.tsx 不应残留 Web legacy 路由入口：${marker}`,
    );
  }
});
