import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openapi = JSON.parse(readFileSync('packages/shared/src/contracts/storyforge.openapi.json', 'utf8'));
const apiTests = {
  series: readFileSync('apps/api/tests/test_series_memory.py', 'utf8'),
  worldbuilding: readFileSync('apps/api/tests/test_worldbuilding_center.py', 'utf8'),
  batchRefinery: readFileSync('apps/api/tests/test_batch_refinery.py', 'utf8'),
  stylePacks: readFileSync('apps/api/tests/test_style_packs.py', 'utf8'),
  quality: readFileSync('apps/api/tests/test_quality_dashboard.py', 'utf8'),
};
const webSources = {
  home: readFileSync('apps/web/app/page.tsx', 'utf8'),
  world: readFileSync('apps/web/app/world/page.tsx', 'utf8'),
  quality: readFileSync('apps/web/app/quality/page.tsx', 'utf8'),
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

test('Phase 2 OpenAPI 暴露系列记忆、世界观中心、批量精修、风格包和质量看板端点', () => {
  assertOperation('/api/series', 'post', '系列级记忆');
  assertOperation('/api/series/{series_id}/memories', 'post', '系列级记忆');
  assertOperation('/api/worldbuilding/center', 'get', '世界观中心');
  assertOperation('/api/batch-refinery/runs', 'post', '批量精修');
  assertOperation('/api/style-packs', 'post', '风格包');
  assertOperation('/api/style-packs/{asset_id}/apply', 'post', '风格包');
  assertOperation('/api/quality/dashboard', 'get', '质量看板');
});

test('Phase 2 后端测试源码保留关键业务证据', () => {
  assertSourceEvidence(apiTests.series, ['"/api/series"', 'memory_type', 'world_rule', '系列不存在']);
  assertSourceEvidence(apiTests.worldbuilding, ['"/api/worldbuilding/center"', 'SeriesMemory', 'cross_book_constraint']);
  assertSourceEvidence(apiTests.batchRefinery, ['"/api/batch-refinery/runs"', 'repair_patch_id', 'partial_failed']);
  assertSourceEvidence(apiTests.stylePacks, ['"/api/style-packs"', 'style_pack', 'style_rule', '保持克制而具画面感']);
  assertSourceEvidence(apiTests.quality, ['"/api/quality/dashboard"', 'repair_acceptance_rate', 'job_success_rate', 'series_memory_count']);
});

test('Phase 2 前端入口包含世界观中心与质量看板', () => {
  assertSourceEvidence(webSources.home, ['/world', '/quality', 'World Center 世界观中心', 'Quality Dashboard 质量看板']);
  assertSourceEvidence(webSources.world, ['角色与关系', '世界规则', '未回收伏笔', '跨书约束']);
  assertSourceEvidence(webSources.quality, ['开放问题', '修复采纳率', '任务成功率', '系列记忆覆盖']);
});
