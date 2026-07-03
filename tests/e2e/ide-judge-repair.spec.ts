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

test('IDE Context Snapshot 契约保留上下文回放字段', () => {
  assertOperation('/api/ide/context-snapshot/{compiled_context_id}', 'get', 'IDE 工作台');

  const snapshot = openapi.components.schemas.IdeContextSnapshot;
  for (const field of [
    'compiled_context_id',
    'injected_blocks',
    'dropped_blocks',
    'debug_summary',
    'budget',
  ]) {
    assert.ok(snapshot.properties[field], `Context Snapshot 必须包含 ${field}`);
  }
});

test('IDE 制品预览契约保留 context_href 回放链接', () => {
  assertOperation('/api/ide/artifacts/{artifact_id}/preview', 'get', 'IDE 工作台');

  const traceLink = openapi.components.schemas.IdeArtifactTraceLink;
  assert.ok(traceLink.properties.context_href, '制品追踪链接必须包含 context_href');
});

test('IDE diagnostics 与命令契约保留 Problems 映射面', () => {
  assertOperation('/api/ide/diagnostics', 'get', 'IDE 工作台');
  assertOperation('/api/ide/commands/{command_id}', 'post', 'IDE 工作台');

  const diagnostic = openapi.components.schemas.IdeDiagnostic;
  for (const field of ['severity', 'code', 'message', 'range', 'quickFixes', 'evidence']) {
    assert.ok(diagnostic.properties[field], `IDE 诊断必须包含 ${field}`);
  }
});
