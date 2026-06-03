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

test('artifacts 页面通过 readJson 复用 API client', () => {
  const content = read('app/artifacts/page.tsx');
  const pageContent = read('app/artifacts/page-content.tsx');
  const api = read('app/artifacts/api.ts');
  assert.ok(api.includes('readJson'));
  assert.ok(content.includes('ArtifactsPageContent'));
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

test('evaluations 页面通过 readJson 复用 API client', () => {
  const content = read('app/evaluations/page.tsx');
  assert.ok(content.includes('readJson'));
  assert.ok(content.includes('aria-labelledby'));
});

test('worldbuilding 页面声明完整入口与 aria 标签', () => {
  const content = read('app/worldbuilding/page.tsx');
  assert.ok(content.includes('aria-labelledby'));
});

test('runs 页面渲染运行时诊断摘要', () => {
  const content = read('app/runs/page.tsx');
  assert.ok(content.includes('运行时诊断'));
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

test('evaluations 详情守卫校验 run 与 trend_points 结构', () => {
  const content = read('app/evaluations/page.tsx');
  assert.ok(
    content.includes('readonly trend_points: readonly EvaluationTrendPoint[]'),
    '详情类型不应把 trend_points 放宽为任意对象数组',
  );
  assert.ok(
    content.includes('isEvaluationRunItem(candidate.run)'),
    '详情守卫应复用运行记录结构校验',
  );
  assert.ok(
    content.includes('isEvaluationTrendPointList(candidate.trend_points)'),
    '详情守卫应拒绝 malformed trend_points',
  );
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
