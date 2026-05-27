import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('首页入口指向 HomeShell 而非旧版导航卡片', () => {
  const page = read('app/page.tsx');
  assert.ok(page.includes("from '../components/home/HomeShell'"), '首页应导入 HomeShell');
  assert.ok(page.includes('<HomeShell />'), '首页应渲染 HomeShell');
  assert.ok(!page.includes('Studio 创作链路'), '首页不应保留旧版主入口卡片');
  assert.ok(!page.includes('治理与诊断入口'), '首页不应保留旧版治理与诊断入口区块');
});

test('home-data 暴露 spec 第 3.2 / 3.6 节定义的入口', () => {
  const data = read('components/home/home-data.ts');
  for (const label of [
    '新建作品',
    '搜索作品与证据',
    '作品库',
    'Studio 审阅',
    'BookRun 整书运行',
    'Retrieval 证据',
    '工件与导出',
    '运行诊断',
  ]) {
    assert.ok(data.includes(`'${label}'`), `导航应包含 ${label}`);
  }
  for (const label of ['创建 Blueprint', '启动 BookRun', '审阅并批准', '核对证据', '导出审计']) {
    assert.ok(data.includes(`'${label}'`), `快捷动作应包含 ${label}`);
  }
  for (const route of [
    '/blueprints',
    '/retrieval',
    '/studio',
    '/book-runs',
    '/artifacts',
    '/runs',
  ]) {
    assert.ok(data.includes(`'${route}'`), `home-data 应映射 ${route}`);
  }
  assert.ok(data.includes('今天要锻造哪段故事？'), '应包含中央主标题文案');
  assert.ok(data.includes('输入故事想法、章节目标或修订要求'), '应包含输入框 placeholder 文案');
});

test('HomeShell 提供顶部状态胶囊并链接到 /providers', () => {
  const shell = read('components/home/HomeShell.tsx');
  assert.ok(shell.includes('href="/providers"'), '顶部状态胶囊应链接 /providers');
  assert.ok(shell.includes('homeWorkspaceLabel'), '应展示 workspace 标签');
  assert.ok(shell.includes('homeProviderUncheckedLabel'), '未读取 Provider 时显示待检查');
  assert.ok(shell.includes('bg-stone-950'), '首页容器使用深色背景');
});

test('HomeSidebar 包含主导航 aria-label 与最近记录空状态', () => {
  const sidebar = read('components/home/HomeSidebar.tsx');
  assert.ok(sidebar.includes('aria-label="StoryForge 主导航"'), '导航应带 aria-label');
  assert.ok(sidebar.includes('最近记录'), '左侧应展示最近记录区块');
  assert.ok(sidebar.includes('homeRecentEmpty'), '最近记录应使用空状态文案');
});

test('HomeComposer 是 Client Component 且输入框有 aria-label', () => {
  const composer = read('components/home/HomeComposer.tsx');
  assert.ok(composer.includes("'use client'"), '输入框需要客户端交互');
  assert.ok(composer.includes('aria-label="创作意图输入"'), '输入框需 aria-label');
  assert.ok(composer.includes("router.push('/blueprints')"), '默认提交跳转 /blueprints');
  assert.ok(composer.includes('htmlFor="home-composer-input"'), '应保留可访问 label 关联');
});

test('HomeQuickActions 用真实链接渲染胶囊按钮', () => {
  const actions = read('components/home/HomeQuickActions.tsx');
  assert.ok(actions.includes('aria-label="创作快捷动作"'), '快捷动作 nav 应带 aria-label');
  assert.ok(actions.includes('homeQuickActions'), '应消费 home-data 数据');
  assert.ok(actions.includes('<Link'), '快捷动作应使用真实链接');
});

test('HomeContextStrip 渲染三张轻量状态卡（含空状态）', () => {
  const strip = read('components/home/HomeContextStrip.tsx');
  for (const label of ['当前作品', '运行状态', '下一步建议']) {
    assert.ok(strip.includes(label), `上下文摘要应包含 ${label}`);
  }
  assert.ok(strip.includes('homeContextEmpty'), '应使用空状态文案常量');
});

test('Chrome 客户端组件在首页禁用旧版 SiteNav 网格', () => {
  const chrome = read('components/site-nav/Chrome.tsx');
  assert.ok(chrome.includes("'use client'"));
  assert.ok(chrome.includes('usePathname'), 'Chrome 应根据路径决定布局');
  assert.ok(chrome.includes("pathname === '/'"), '首页应跳过旧 SiteNav 网格');
  const layout = read('app/layout.tsx');
  assert.ok(layout.includes("from '../components/site-nav/Chrome'"), 'layout 应使用 Chrome');
  assert.ok(!layout.includes('SiteNav '), 'layout 不应直接引用 SiteNav');
});

test('首页不残留 Claude 无关分类', () => {
  const data = read('components/home/home-data.ts');
  const shell = read('components/home/HomeShell.tsx');
  for (const phrase of ['Code', 'Learn', 'Life stuff', 'Write essays', '休闲生活']) {
    assert.ok(!data.includes(phrase), `home-data 不应残留 Claude 分类 ${phrase}`);
    assert.ok(!shell.includes(phrase), `HomeShell 不应残留 Claude 分类 ${phrase}`);
  }
});
