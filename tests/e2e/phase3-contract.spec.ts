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

test('Phase 3 OpenAPI 暴露工作区、协作、商业化与分析端点', () => {
  assertOperation('/api/workspaces', 'post', '团队工作区');
  assertOperation('/api/workspaces', 'get', '团队工作区');
  assertOperation('/api/collaboration/comments', 'post', '协作审批');
  assertOperation('/api/commercial/workspaces/{workspace_id}/policy', 'post', '商业化控制');
  assertOperation('/api/commercial/workspaces/{workspace_id}/summary', 'get', '商业化控制');
  assertOperation('/api/analytics/workspaces/{workspace_id}/dashboard', 'get', '分析扩展');
});

test('Phase 3 契约保留席位、配额与 Provider 能力字段', () => {
  const workspaceCreate = openapi.components.schemas.WorkspaceCreate;
  assert.ok(workspaceCreate.properties.seat_limit, '工作区请求必须允许设置 seat_limit');

  const commercialSummary = openapi.components.schemas.CommercialSummaryRead;
  assert.ok(commercialSummary.properties.monthly_job_limit, '商业化摘要必须包含 monthly_job_limit');
  assert.ok(commercialSummary.properties.within_limits, '商业化摘要必须包含 within_limits');

  const providerConfig = openapi.components.schemas.ProviderConfigRead;
  assert.ok(providerConfig.properties.capabilities, 'Provider 配置响应必须包含 capabilities');
  assert.ok(providerConfig.properties.model_aliases, 'Provider 配置响应必须包含 model_aliases');
});
