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
  return operation;
}

test('Assistant 修订契约保留请求与响应关键字段', () => {
  assertOperation('/api/assistant/revise', 'post', 'Assistant 会话');

  const reviseRequest = openapi.components.schemas.AssistantReviseRequest;
  assert.deepEqual(reviseRequest.required, ['file_path', 'content', 'instruction']);
  assert.ok(reviseRequest.properties.context_bundle, '修订请求必须允许携带 context_bundle');

  const reviseResponse = openapi.components.schemas.AssistantReviseResponse;
  for (const field of [
    'before',
    'after',
    'summary',
    'model',
    'latency_ms',
    'assistant_session_id',
  ]) {
    assert.ok(reviseResponse.properties[field], `修订响应必须包含 ${field}`);
  }
});

// 旧 IDE 只读 HTTP 面已退役；内部服务/schema 保留，不恢复无 Desktop 调用方的路由。
// 源码层的 test_source_pruning.py 同时守护 runtime 路由；这里守护发布给客户端的契约。
test('IDE 已退役读路由不重新进入客户端契约', () => {
  for (const path of [
    '/api/ide/diagnostics',
    '/api/ide/context-snapshot/{compiled_context_id}',
    '/api/ide/artifacts/{artifact_id}/preview',
  ]) {
    assert.equal(openapi.paths[path], undefined, `已退役路由被重新暴露：${path}`);
  }
});

test('Agent 回放事件与产物契约保留顺序、证据和确认字段', () => {
  for (const [suffix, schemaName, fields] of [
    ['events', 'AgentRunEventRead', ['id', 'run_id', 'event_type', 'sequence', 'payload']],
    ['artifacts', 'AgentArtifactRead', ['id', 'run_id', 'kind', 'payload', 'requires_confirmation']],
  ]) {
    const operation = assertOperation(`/api/agent-runs/{run_id}/${suffix}`, 'get', 'Agent Runtime');
    const response = operation.responses['200'].content['application/json'].schema;
    assert.equal(response.type, 'array');
    assert.equal(response.items.$ref, `#/components/schemas/${schemaName}`);
    const schema = openapi.components.schemas[schemaName];
    for (const field of fields) {
      assert.ok(schema.properties[field], `${schemaName} 必须包含 ${field}`);
      assert.ok(schema.required.includes(field), `${schemaName}.${field} 必须为必填字段`);
    }
  }
});

test('IDE 现行命令契约保留审计追踪与结果载荷', () => {
  const operation = assertOperation('/api/ide/commands/{command_id}', 'post', 'IDE 工作台');
  assert.equal(
    operation.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/IdeCommandResult',
  );
  assert.ok(openapi.components.schemas.IdeCommandRequest.properties.args);
  const result = openapi.components.schemas.IdeCommandResult;
  for (const field of ['command_id', 'status', 'audit_event_id', 'payload']) {
    assert.ok(result.properties[field], `IDE 命令结果必须包含 ${field}`);
  }
});
