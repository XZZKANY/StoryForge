import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  normalizeProviderBaseUrl,
  probeProviderModels,
} from '../app/api/provider-models/provider-models';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('设置页提供 Provider 地址保存、检测和模型列表能力', () => {
  const page = read('app/settings/page.tsx');
  const client = read('app/settings/SettingsClient.tsx');
  const provider = read('app/settings/ProviderSettingsPanel.tsx');

  assert.ok(page.includes('SettingsClient'), '设置页应渲染客户端设置表单');
  assert.ok(client.includes("'use client'"), '设置表单需要客户端交互');
  assert.ok(provider.includes('storyforge-provider-settings'), '设置应保存到浏览器 localStorage');
  assert.ok(provider.includes('Provider Base URL'), '页面应提供 Provider Base URL 字段');
  assert.ok(!provider.includes('provider-api-key'), '页面不应渲染密钥输入框');
  assert.ok(provider.includes('保存设置'), '页面应提供显式保存按钮');
  assert.ok(provider.includes('saveProviderSettings'), '保存按钮应调用保存函数');
  assert.ok(provider.includes('检测并拉取模型'), '页面应提供检测按钮');
  assert.ok(provider.includes('/api/provider-models'), '检测按钮应调用模型检测 API');
  assert.ok(provider.includes('readCurrentFormSettings'), '检测时应从表单读取当前值');
  assert.ok(provider.includes('可用模型'), '成功后应展示模型列表');
});

test('模型检测 API 使用 OpenAI-compatible /v1/models 协议', () => {
  const route = read('app/api/provider-models/route.ts');
  const core = read('app/api/provider-models/provider-models.ts');

  assert.ok(route.includes('export async function POST'), '模型检测应使用 POST route');
  assert.ok(core.includes('/v1/models'), '模型检测应请求 OpenAI-compatible /v1/models');
  assert.ok(core.includes('normalizeProviderBaseUrl'), '应规范化 Provider Base URL');
  assert.ok(core.includes('data'), '应读取模型响应 data 字段');
  assert.ok(core.includes('models'), '应返回模型列表');
});

test('模型检测核心逻辑能规范化地址并提取模型', async () => {
  assert.equal(normalizeProviderBaseUrl('api.deepseek.com/v1/'), 'https://api.deepseek.com');

  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
  const fakeFetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({ data: [{ id: 'z-model' }, { id: 'a-model' }, { bad: true }] }),
      {
        status: 200,
      },
    );
  }) as typeof fetch;

  const result = await probeProviderModels({ baseUrl: 'https://api.example.com/v1' }, fakeFetch);

  assert.deepEqual(result, {
    ok: true,
    endpoint: 'https://api.example.com/v1/models',
    models: ['a-model', 'z-model'],
  });
  assert.equal(calls[0].url, 'https://api.example.com/v1/models');
  assert.equal(new Headers(calls[0].init.headers).get('Accept'), 'application/json');
});

test('设置入口接入首页和全局导航', () => {
  const nav = read('components/site-nav/site-nav-links.ts');
  const home = read('components/home/home-data.ts');
  const shell = read('components/home/HomeShell.tsx');
  const sidebar = read('components/home/HomeSidebar.tsx');

  assert.ok(nav.includes("href: '/settings'"), '全局导航应包含 /settings');
  assert.ok(nav.includes('模型设置'), '全局导航应展示模型设置入口');
  assert.ok(home.includes("href: '/settings'"), '首页账号菜单应包含 /settings');
  assert.ok(home.includes('Provider/API Key'), '首页账号菜单应展示 Provider/API Key 系统设置入口');
  assert.ok(sidebar.includes('homeAccountMenuItems'), '首页设置入口应收纳在左侧账号菜单');
  assert.ok(sidebar.includes('isAccountMenuOpen &&'), '账号菜单应点击后弹出设置入口');
  assert.ok(!shell.includes('href="/settings"'), '首页右侧顶部不应再展示 Provider 状态胶囊');
});

test('创作偏好独立于 Provider 设置并并入首页项目工作台', () => {
  const panel = read('app/settings/CreativePreferencesPanel.tsx');
  const home = read('components/home/home-data.ts');
  const projects = read('components/home/HomeProjectsPanel.tsx');

  assert.ok(
    panel.includes('storyforge-creative-preferences'),
    '创作偏好应使用独立 localStorage key',
  );
  for (const phrase of ['默认题材', '默认文风', 'Assistant 行为', '默认流程']) {
    assert.ok(panel.includes(phrase), `创作偏好应包含 ${phrase}`);
  }
  for (const forbidden of [
    'storyforge-provider-settings',
    'Provider Base URL',
    '/api/provider-models',
    'provider-api-key',
  ]) {
    assert.ok(!panel.includes(forbidden), `创作偏好不得混入系统设置 ${forbidden}`);
  }
  assert.ok(!home.includes("view: 'customize'"), '首页不应保留独立 Customize 子页');
  assert.ok(!home.includes("view: 'new-project'"), 'New project 不应作为首页一级导航');
  assert.ok(projects.includes('New project'), 'Projects 应承载新建项目入口');
  assert.ok(home.includes('Provider/API Key'), 'Provider/API Key 仍留在账号菜单');
  assert.ok(!panel.includes('rounded-3xl'), '创作偏好嵌入项目页时不应保持大卡片外观');
  assert.ok(!panel.includes('shadow-2xl'), '创作偏好不应使用厚重卡片阴影');
  assert.ok(!panel.includes("genres: ['悬疑', '奇幻']"), '创作偏好不应预填假题材');
  assert.ok(!panel.includes('凝练电影感'), '创作偏好不应预填假文风');
  assert.ok(!panel.includes('rounded-2xl border'), '创作偏好表单不应使用卡片化圆角边框块');
});

test('设置页具备浏览器交互验证入口', () => {
  const packageJson = read('package.json');
  const scriptPath = 'scripts/verify-settings-browser.mjs';

  assert.ok(existsSync(join(root, scriptPath)), 'settings 页应提供专属 Playwright 浏览器验证脚本');
  assert.ok(
    packageJson.includes('"verify:settings-browser"'),
    'web 包应暴露 settings 浏览器验证脚本',
  );
  assert.ok(
    packageJson.includes('node scripts/verify-settings-browser.mjs'),
    'settings 浏览器验证脚本应指向 verify-settings-browser.mjs',
  );
});
