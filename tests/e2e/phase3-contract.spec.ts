import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openapi = JSON.parse(
  readFileSync('packages/shared/src/contracts/storyforge.openapi.json', 'utf8'),
);

function assertOperation(path, method, tag) {
  const operation = openapi.paths?.[path]?.[method];
  assert.ok(operation, `缺少 ${method.toUpperCase()} ${path}`);
  assert.ok(operation.tags?.includes(tag), `${path} 未归入 ${tag} 标签`);
}

test('Phase 3 OpenAPI 暴露当前保留的事件流和 Provider Gateway 端点', () => {
  assertOperation('/api/events', 'post', '事件流');
  assertOperation('/api/events/workspaces/{workspace_id}', 'get', '事件流');
  assertOperation('/api/provider-gateway/providers', 'post', '模型接入层');
  assertOperation('/api/provider-gateway/providers', 'get', '模型接入层');
  assertOperation('/api/provider-gateway/resolve', 'get', '模型接入层');
});

// W4 batch-2b：workspaces 已作为冻结域卸载 router（见 app/domains/DOMAINS.md），
// 契约不再暴露其端点/schema；provider-gateway 与 events 仍保留。
test('Phase 3 契约保留 Provider 能力字段', () => {
  const providerConfig = openapi.components.schemas.ProviderConfigRead;
  assert.ok(providerConfig.properties.capabilities, 'Provider 配置响应必须包含 capabilities');
  assert.ok(providerConfig.properties.model_aliases, 'Provider 配置响应必须包含 model_aliases');
});
