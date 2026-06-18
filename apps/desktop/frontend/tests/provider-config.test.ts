import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyProviderPreset,
  describeProviderConnection,
  isProviderKind,
  PROVIDER_OPTIONS,
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
