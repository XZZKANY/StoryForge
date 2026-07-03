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

test('Phase 2 OpenAPI 暴露当前保留的系列记忆、批量精修和风格包端点', () => {
  assertOperation('/api/series', 'post', '系列级记忆');
  assertOperation('/api/series/{series_id}/memories', 'post', '系列级记忆');
  assertOperation('/api/batch-refinery/runs', 'post', '批量精修');
  assertOperation('/api/batch-refinery/runs/{job_id}', 'get', '批量精修');
  assertOperation('/api/style-packs', 'post', '风格包');
  assertOperation('/api/style-packs/{asset_id}/apply', 'post', '风格包');
});

test('Phase 2 契约保留系列记忆、批量精修与风格包关键字段', () => {
  const seriesMemoryCreate = openapi.components.schemas.SeriesMemoryCreate;
  assert.deepEqual(seriesMemoryCreate.required, ['memory_type', 'subject']);
  assert.ok(seriesMemoryCreate.properties.payload, '系列记忆请求必须允许携带 payload');

  const batchItemCreate = openapi.components.schemas.BatchRefineryItemCreate;
  assert.ok(batchItemCreate.properties.scene_id, '批量精修条目必须绑定 scene_id');
  assert.ok(batchItemCreate.properties.required_facts, '批量精修条目必须允许携带 required_facts');
  assert.ok(batchItemCreate.properties.style_rules, '批量精修条目必须允许携带 style_rules');

  const batchRunRead = openapi.components.schemas.BatchRefineryRunRead;
  assert.ok(batchRunRead.properties.progress, '批量精修运行响应必须包含 progress');
  assert.ok(batchRunRead.properties.status, '批量精修运行响应必须包含 status');

  const stylePackCreate = openapi.components.schemas.StylePackCreate;
  assert.deepEqual(stylePackCreate.required, ['book_id', 'name']);
  const stylePackApplyCreate = openapi.components.schemas.StylePackApplyCreate;
  assert.deepEqual(stylePackApplyCreate.required, ['book_id']);
});
