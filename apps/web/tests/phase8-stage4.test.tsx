import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('retrieval 页面声明 aria-labelledby 和检索证据描述', () => {
  const content = read('app/retrieval/page.tsx');
  assert.ok(content.includes('aria-labelledby'));
  assert.ok(content.includes('searchParams'));
});

test('artifacts 工作台通过 readJson 复用 API client', () => {
  const pageContent = read('app/artifacts/page-content.tsx');
  const api = read('app/artifacts/api.ts');
  assert.ok(api.includes('readJson'));
  assert.ok(pageContent.includes('ArtifactsPageContent'));
  assert.ok(pageContent.includes('ArtifactsWorkbench'));
  assert.ok(pageContent.includes('aria-labelledby'));
  assert.ok(
    pageContent.includes('grid grid-cols-[1.2fr_0.8fr_0.7fr_1fr]'),
    'Artifacts 应以列表列结构展示制品',
  );
  assert.ok(!pageContent.includes('未实现边界'), 'Artifacts 首页工作台不应把未实现说明作为主内容');
  assert.ok(!pageContent.includes('仍未实现'), 'Artifacts 不应把未实现说明写进主工作台');
  assert.ok(
    !pageContent.includes('const artifactSections'),
    'Artifacts 不应使用静态分类清单伪装产物导航',
  );
});

test('IDE evaluation 面板通过 legacy redirect 承接旧评测入口', () => {
  const nextConfig = read('next.config.ts');
  const editorArea = read('components/ide/shell/EditorArea.tsx');
  const bottomPanel = read('components/ide/shell/BottomPanel.tsx');
  const ideUrlState = read('components/ide/url/ide-url-state.ts');

  assert.ok(nextConfig.includes("source: '/evaluations'"));
  assert.ok(nextConfig.includes("destination: '/ide?panel.bottom=evaluation'"));
  assert.ok(editorArea.includes("'legacy:evaluations'"));
  assert.ok(editorArea.includes('Evaluations 评测系统'));
  assert.ok(bottomPanel.includes("'evaluation'"));
  assert.ok(ideUrlState.includes("| 'evaluation'"));
});

test('worldbuilding 页面声明完整入口与 aria 标签', () => {
  const content = read('app/worldbuilding/page.tsx');
  assert.ok(content.includes('aria-labelledby'));
});

test('IDE runs 面板渲染运行控制台和 SSE 事件摘要', () => {
  const panel = read('components/ide/views/BookRunPanel.tsx');
  const eventsPanel = read('components/ide/views/BookRunEventsPanel.tsx');
  assert.ok(panel.includes('BookRun Run Panel'));
  assert.ok(panel.includes('checkpoint'));
  assert.ok(eventsPanel.includes('SSE 快照事件'));
  assert.ok(eventsPanel.includes('/api/book-runs/${run.id}/events'));
});

test('layout 加载侧栏导航与主题切换', () => {
  const layout = read('app/layout.tsx');
  const chrome = read('components/site-nav/Chrome.tsx');
  assert.ok(layout.includes('Chrome'), 'layout 应通过 Chrome 包装侧栏与主题切换');
  assert.ok(layout.includes('./globals.css'));
  assert.ok(chrome.includes('SiteNav'), 'Chrome 应继续装配 SiteNav');
  assert.ok(chrome.includes('ThemeToggle'), 'Chrome 应继续装配 ThemeToggle');
});

test('globals.css 包含 data-theme="dark" 暗色模式覆盖', () => {
  const css = read('app/globals.css');
  assert.ok(css.includes('[data-theme="dark"]'));
  assert.ok(css.includes('color-scheme: dark'));
});

test('JobStatusPoller 客户端组件存在且为 use client', () => {
  const content = read('components/job-status/JobStatusPoller.tsx');
  assert.ok(content.includes("'use client'"));
  assert.ok(content.includes('parseJobRunSnapshot'));
  assert.ok(content.includes('intervalMs'));
  assert.ok(
    content.includes('/api/model-runs/job-runs'),
    'JobStatusPoller 默认端点应指向真实 JobRun 状态 API',
  );
});

test('JobStatusPoller 错误重试会触发新的轮询请求', () => {
  const content = read('components/job-status/JobStatusPoller.tsx');
  assert.ok(content.includes('retryAttempt'), '重试应维护独立触发值');
  assert.ok(
    content.includes('setRetryAttempt((attempt) => attempt + 1)'),
    '点击重试应递增触发值，确保 effect 重新执行 fetch',
  );
  assert.ok(
    content.includes('[fetchSnapshot, intervalMs, retryAttempt]'),
    '轮询 effect 依赖应包含重试触发值',
  );
});

test('evaluations 契约由 OpenAPI 保留运行详情和失败样例结构', () => {
  const openApi = JSON.parse(
    read('../../packages/shared/src/contracts/storyforge.openapi.json'),
  ) as {
    readonly paths?: Record<string, unknown>;
    readonly components?: { readonly schemas?: Record<string, unknown> };
  };

  assert.ok(openApi.paths?.['/api/evaluations/runs/{run_id}']);
  assert.ok(openApi.paths?.['/api/evaluations/runs/{run_id}/failed-samples']);
  assert.ok(openApi.components?.schemas?.EvaluationRunDetailRead);
  assert.ok(openApi.components?.schemas?.EvaluationFailedSampleRead);
});

test('Studio 多步骤向导扩展了预览 Scene Packet 子步骤', () => {
  const pageContent = read('app/studio/page-content.tsx');
  assert.ok(pageContent.includes('预览 Scene Packet'));
  assert.ok(pageContent.includes("id: 'preview'"));
});

test('SiteNav 暴露移动端折叠与可访问性属性', () => {
  const content = read('components/site-nav/SiteNav.tsx');
  assert.ok(content.includes('aria-expanded'));
  assert.ok(content.includes('aria-controls'));
  assert.ok(content.includes('site-nav-sidebar'));
});
