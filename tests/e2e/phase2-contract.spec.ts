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

// W4：batch-refinery 已作为冻结域卸载 router（见 app/domains/DOMAINS.md），
// 契约不再暴露其端点/schema；series 与 style-packs 仍保留。
test('Phase 2 OpenAPI 暴露当前保留的系列记忆和风格包端点', () => {
  assertOperation('/api/series', 'post', '系列级记忆');
  assertOperation('/api/series/{series_id}/memories', 'post', '系列级记忆');
  assertOperation('/api/style-packs', 'post', '风格包');
  assertOperation('/api/style-packs/{asset_id}/apply', 'post', '风格包');
});

test('Phase 2 契约保留系列记忆与风格包关键字段', () => {
  const seriesMemoryCreate = openapi.components.schemas.SeriesMemoryCreate;
  assert.deepEqual(seriesMemoryCreate.required, ['memory_type', 'subject']);
  assert.ok(seriesMemoryCreate.properties.payload, '系列记忆请求必须允许携带 payload');

  const stylePackCreate = openapi.components.schemas.StylePackCreate;
  assert.deepEqual(stylePackCreate.required, ['book_id', 'name']);
  const stylePackApplyCreate = openapi.components.schemas.StylePackApplyCreate;
  assert.deepEqual(stylePackApplyCreate.required, ['book_id']);
});
