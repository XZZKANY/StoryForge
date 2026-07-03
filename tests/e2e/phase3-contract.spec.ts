import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openapi = JSON.parse(
  readFileSync('packages/shared/src/contracts/storyforge.openapi.json', 'utf8'),
);
const apiTests = {
  workspaces: readFileSync('apps/api/tests/test_workspaces_api.py', 'utf8'),
  collaboration: readFileSync('apps/api/tests/test_collaboration.py', 'utf8'),
  commercial: readFileSync('apps/api/tests/test_commercial_controls.py', 'utf8'),
  providerGateway: readFileSync('apps/api/tests/test_provider_gateway.py', 'utf8'),
  analytics: readFileSync('apps/api/tests/test_phase3_analytics.py', 'utf8'),
};
const desktopSources = {
  settings: readFileSync('apps/desktop/frontend/src/components/SettingsView.tsx', 'utf8'),
  providerConfig: readFileSync('apps/desktop/frontend/src/lib/provider-config.ts', 'utf8'),
};

function assertOperation(path, method, tag) {
  const operation = openapi.paths?.[path]?.[method];
  assert.ok(operation, `缺少 ${method.toUpperCase()} ${path}`);
  assert.ok(operation.tags?.includes(tag), `${path} 未归入 ${tag} 标签`);
}

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少 Phase 3 证据：${marker}`);
  }
}

test('Phase 3 OpenAPI 暴露当前保留的事件流和 Provider Gateway 端点', () => {
  assertOperation('/api/events', 'post', '事件流');
  assertOperation('/api/events/workspaces/{workspace_id}', 'get', '事件流');
  assertOperation('/api/provider-gateway/providers', 'post', '模型接入层');
  assertOperation('/api/provider-gateway/providers', 'get', '模型接入层');
  assertOperation('/api/provider-gateway/resolve', 'get', '模型接入层');
});

test('Phase 3 后端测试源码保留当前能力与退役边界证据', () => {
  assertSourceEvidence(apiTests.workspaces, ['"/api/workspaces"', 'seat_limit', '404']);
  assertSourceEvidence(apiTests.collaboration, [
    '"/api/collaboration/comments"',
    '建议加强旧伤带来的动作限制',
    '400',
  ]);
  assertSourceEvidence(apiTests.commercial, [
    '"/api/commercial/workspaces/',
    'monthly_job_limit',
    '404',
  ]);
  assertSourceEvidence(apiTests.providerGateway, [
    '"/api/provider-gateway/providers"',
    'capabilities',
    'claude-sonnet',
    'gpt-5.5',
  ]);
  assertSourceEvidence(apiTests.analytics, ['"/api/analytics/workspaces/', '分析扩展', '404']);
});

test('Phase 3 Desktop 设置保留 Provider 配置入口', () => {
  assertSourceEvidence(desktopSources.settings, [
    '模型服务',
    '服务类型',
    '服务地址',
    '默认模型',
    'API Key',
  ]);
  assertSourceEvidence(desktopSources.providerConfig, [
    'openai',
    'deepseek',
    'ollama',
    'openai-compatible',
  ]);
});
