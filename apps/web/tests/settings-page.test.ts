import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

  assert.ok(page.includes('SettingsClient'), '设置页应渲染客户端设置表单');
  assert.ok(client.includes("'use client'"), '设置表单需要客户端交互');
  assert.ok(client.includes('storyforge-provider-settings'), '设置应保存到浏览器 localStorage');
  assert.ok(client.includes('Provider Base URL'), '页面应提供 Provider Base URL 字段');
  assert.ok(!client.includes('provider-api-key'), '页面不应渲染密钥输入框');
  assert.ok(client.includes('保存设置'), '页面应提供显式保存按钮');
  assert.ok(client.includes('saveProviderSettings'), '保存按钮应调用保存函数');
  assert.ok(client.includes('检测并拉取模型'), '页面应提供检测按钮');
  assert.ok(client.includes('/api/provider-models'), '检测按钮应调用模型检测 API');
  assert.ok(client.includes('readCurrentFormSettings'), '检测时应从表单读取当前值');
  assert.ok(client.includes('可用模型'), '成功后应展示模型列表');
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

  assert.ok(nav.includes("href: '/settings'"), '全局导航应包含 /settings');
  assert.ok(nav.includes('模型设置'), '全局导航应展示模型设置入口');
  assert.ok(home.includes("href: '/settings'"), '首页导航应包含 /settings');
  assert.ok(home.includes('模型与 Provider'), '首页应展示模型与 Provider 入口');
  assert.ok(shell.includes('href="/settings"'), '首页顶部 Provider 状态应链接设置页');
});
