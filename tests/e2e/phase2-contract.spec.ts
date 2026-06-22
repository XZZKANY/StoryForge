import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openapi = JSON.parse(
  readFileSync('packages/shared/src/contracts/storyforge.openapi.json', 'utf8'),
);
const apiTests = {
  series: readFileSync('apps/api/tests/test_series_memory.py', 'utf8'),
  batchRefinery: readFileSync('apps/api/tests/test_batch_refinery.py', 'utf8'),
  stylePacks: readFileSync('apps/api/tests/test_style_packs.py', 'utf8'),
};

function assertOperation(path, method, tag) {
  const operation = openapi.paths?.[path]?.[method];
  assert.ok(operation, `缺少 ${method.toUpperCase()} ${path}`);
  assert.ok(operation.tags?.includes(tag), `${path} 未归入 ${tag} 标签`);
}

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少 Phase 2 证据：${marker}`);
  }
}

test('Phase 2 OpenAPI 暴露当前保留的系列记忆、批量精修和风格包端点', () => {
  assertOperation('/api/series', 'post', '系列级记忆');
  assertOperation('/api/series/{series_id}/memories', 'post', '系列级记忆');
  assertOperation('/api/batch-refinery/runs', 'post', '批量精修');
  assertOperation('/api/style-packs', 'post', '风格包');
  assertOperation('/api/style-packs/{asset_id}/apply', 'post', '风格包');
});

test('Phase 2 后端测试源码保留当前业务证据', () => {
  assertSourceEvidence(apiTests.series, [
    '"/api/series"',
    'memory_type',
    'world_rule',
    '系列不存在',
  ]);
  assertSourceEvidence(apiTests.batchRefinery, [
    '"/api/batch-refinery/runs"',
    'repair_patch_id',
    'partial_failed',
  ]);
  assertSourceEvidence(apiTests.stylePacks, [
    '"/api/style-packs"',
    'style_pack',
    'style_rule',
    '保持克制而具画面感',
  ]);
});
