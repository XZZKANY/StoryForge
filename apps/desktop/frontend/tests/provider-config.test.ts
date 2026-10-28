import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  describeProviderHealth,
  isProviderKind,
  PROVIDER_OPTIONS,
  PROVIDER_PRESETS,
  profileTitle,
  providerKindOr,
  type ProviderHealth,
} from '../src/lib/provider-config';
import { sanitizeAppSettings } from '../src/lib/user-settings';

test('provider configuration exposes stable presets for settings UI', () => {
  // 「StoryForge 本地网关」指向已删的 Python 后端，不再作为选项。
  assert.equal(
    PROVIDER_OPTIONS.some((option) => option.label.includes('StoryForge')),
    false,
  );
  assert.equal(isProviderKind('local'), false);
  assert.ok(PROVIDER_OPTIONS.some((option) => option.value === 'anthropic'));
  assert.ok(PROVIDER_OPTIONS.some((option) => option.value === 'gemini'));
  assert.ok(isProviderKind('openai'));
  assert.equal(isProviderKind('missing-provider'), false);
});

test('预设地址可以直接用：引擎在后面接 /chat/completions，兼容服务都写到 /v1；中转不预填', () => {
  assert.equal(PROVIDER_PRESETS['openai-compatible'].baseUrl, '');
  assert.equal(PROVIDER_PRESETS['openai-compatible'].label, '自定义 / 中转');
  for (const kind of ['openai', 'anthropic', 'kimi', 'siliconflow', 'qwen', 'ollama'] as const)
    assert.match(PROVIDER_PRESETS[kind].baseUrl, /\/v1$/, kind);
  assert.match(PROVIDER_PRESETS.gemini.baseUrl, /\/v1beta$/);
  for (const preset of Object.values(PROVIDER_PRESETS))
    assert.doesNotMatch(preset.baseUrl, /\/$/, preset.kind);
});

test('旧版存过「本地网关」的配置按兼容 OpenAI 读', () => {
  assert.equal(providerKindOr('local', 'openai'), 'openai-compatible');
  assert.equal(providerKindOr('missing-provider', 'anthropic'), 'anthropic');
});

test('卡片名字：起过名用名字，否则「服务商 · 模型」', () => {
  assert.equal(profileTitle({ name: ' 写正文 ', provider: 'kimi', model: 'kimi-k2' }), '写正文');
  assert.equal(profileTitle({ name: '', provider: 'kimi', model: 'kimi-k2' }), 'Kimi · kimi-k2');
  assert.equal(
    profileTitle({ name: '', provider: 'local', model: '' }),
    '自定义 / 中转 · 未选模型',
  );
});

test('本机偏好不再镜像模型配置：旧版存的 provider / polishProvider 读的时候丢掉', () => {
  const settings = sanitizeAppSettings({
    editorFontSize: 99,
    autoSave: true,
    provider: { kind: 'openai', baseUrl: 'https://main.example/v1', model: 'm', apiKeyRef: '' },
    polishProvider: { kind: 'gemini', baseUrl: 'https://p.example', model: 'p', apiKeyRef: '' },
  });
  assert.equal(settings.editorFontSize, 20);
  assert.equal(settings.autoSave, true);
  assert.equal('provider' in settings, false);
  assert.equal('polishProvider' in settings, false);
});

function health(overrides: Partial<ProviderHealth>): ProviderHealth {
  return {
    status: 'ok',
    reachable: true,
    baseUrl: 'https://provider.test/v1',
    model: null,
    latencyMs: null,
    modelCount: null,
    detail: null,
    missingEnv: [],
    ...overrides,
  };
}

test('describeProviderHealth renders ok with model, latency and model count', () => {
  const display = describeProviderHealth(
    health({ status: 'ok', model: 'deepseek-v4-flash', latencyMs: 1407, modelCount: 2 }),
  );
  assert.equal(display.tone, 'ok');
  assert.ok(display.label.includes('deepseek-v4-flash'));
  assert.ok(display.label.includes('1407ms'));
  assert.ok(display.label.includes('2 个模型'));
  assert.ok(display.label.includes('没有真发对话'));
});

test('describeProviderHealth warns when the configured model is missing from the list', () => {
  const missing = describeProviderHealth(
    health({ model: 'claude-sonnet-5-5', modelCount: 2, models: ['claude-sonnet-5', 'kimi'] }),
  );
  assert.equal(missing.tone, 'warn');
  assert.ok(missing.label.includes('claude-sonnet-5-5'));
  const listed = describeProviderHealth(
    health({ model: 'kimi', modelCount: 2, models: ['claude-sonnet-5', 'kimi'] }),
  );
  assert.equal(listed.tone, 'ok');
  // 部分列表（detail 非空）不下「没有」的结论。
  const partial = describeProviderHealth(
    health({ model: 'other', models: ['kimi'], detail: '仅显示本次探测返回的部分模型' }),
  );
  assert.equal(partial.tone, 'ok');
});

test('describeProviderHealth surfaces unauthorized and unreachable as errors', () => {
  assert.equal(
    describeProviderHealth(health({ status: 'unauthorized', detail: 'HTTP 401' })).tone,
    'error',
  );
  assert.equal(
    describeProviderHealth(health({ status: 'unreachable', reachable: false, detail: '连接被拒' }))
      .tone,
    'error',
  );
});

test('describeProviderHealth marks misconfigured with missing env as a warning', () => {
  const display = describeProviderHealth(
    health({ status: 'misconfigured', reachable: false, missingEnv: ['STORYFORGE_LLM_API_KEY'] }),
  );
  assert.equal(display.tone, 'warn');
  assert.equal(display.label, '还没填：API Key');
});

test('describeProviderHealth 不再说「后端」', () => {
  const ok = describeProviderHealth(health({ status: 'ok' }));
  const bare = describeProviderHealth(health({ status: 'misconfigured', reachable: false }));
  for (const label of [ok.label, bare.label]) assert.equal(label.includes('后端'), false, label);
});
