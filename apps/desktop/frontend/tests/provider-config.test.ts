import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyProviderPreset,
  describeProviderConnection,
  describeProviderHealth,
  isProviderKind,
  PROVIDER_OPTIONS,
  type ProviderHealth,
} from '../src/lib/provider-config';
import { sanitizeAppSettings } from '../src/lib/user-settings';

test('provider configuration exposes stable presets for settings UI', () => {
  assert.ok(PROVIDER_OPTIONS.some((option) => option.value === 'local' && option.label.includes('StoryForge')));
  assert.ok(isProviderKind('openai'));
  assert.equal(isProviderKind('missing-provider'), false);

  const next = applyProviderPreset(
    {
      kind: 'openai',
      baseUrl: 'https://api.openai.com',
      model: 'keep-this-model',
      apiKeyRef: 'OPENAI_API_KEY',
    },
    'deepseek',
    { preserveModel: true },
  );

  assert.deepEqual(next, {
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'keep-this-model',
    apiKeyRef: 'DEEPSEEK_API_KEY',
  });
});

test('provider configuration describes actionable connection states', () => {
  assert.deepEqual(
    describeProviderConnection({
      kind: 'local',
      baseUrl: 'http://localhost:8000',
      model: '',
      apiKeyRef: '',
    }),
    {
      status: 'local',
      label: '本地模型服务',
    },
  );

  assert.deepEqual(
    describeProviderConnection({
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com',
      model: '',
      apiKeyRef: '',
    }),
    {
      status: 'needs-api-key',
      label: '缺少密钥引用',
    },
  );
});

test('app settings sanitizer shares provider kind validation with provider configuration', () => {
  const settings = sanitizeAppSettings({
    editorFontSize: 99,
    autoSave: true,
    provider: {
      kind: 'missing-provider',
      baseUrl: '',
      model: 123,
      apiKeyRef: 456,
    },
  });

  assert.equal(settings.editorFontSize, 20);
  assert.equal(settings.autoSave, true);
  assert.equal(settings.provider.kind, 'openai');
  assert.equal(settings.provider.baseUrl, 'https://api.openai.com');
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
  assert.ok(display.label.includes('STORYFORGE_LLM_API_KEY'));
});
