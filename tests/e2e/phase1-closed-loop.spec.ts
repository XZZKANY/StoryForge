import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const openapi = JSON.parse(readFileSync('packages/shared/src/contracts/storyforge.openapi.json', 'utf8'));

const apiTests = {
  scenePacket: readFileSync('apps/api/tests/test_scene_packet.py', 'utf8'),
  judgeRepair: readFileSync('apps/api/tests/test_judge_repair.py', 'utf8'),
  approvalWriteback: readFileSync('apps/api/tests/test_approval_writeback.py', 'utf8'),
  exports: readFileSync('apps/api/tests/test_exports.py', 'utf8'),
  phase1ClosedLoopApi: readFileSync('apps/api/tests/test_phase1_closed_loop_api.py', 'utf8'),
};

function assertOperation(path, method, tag) {
  const operation = openapi.paths?.[path]?.[method];
  assert.ok(operation, `缺少 ${method.toUpperCase()} ${path}`);
  assert.ok(operation.tags?.includes(tag), `${path} 未归入 ${tag} 标签`);
  return operation;
}

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少闭环证据：${marker}`);
  }
}

test('第一阶段契约检查确认 OpenAPI 暴露关键端点', () => {
  assert.equal(openapi.info?.title, 'StoryForge API');
  assertOperation('/api/assets', 'post', '资产中心');
  assertOperation('/api/assets', 'get', '资产中心');
  assertOperation('/api/scene-packets', 'post', '场景上下文包');
  assertOperation('/api/judge/issues', 'post', '结构化评审');
  assertOperation('/api/repair/patches', 'post', '定向修复');
  assertOperation('/api/continuity/chapter-approval', 'post', '章节连续性');
  assertOperation('/api/books/{book_id}/exports/markdown', 'get', '作品导出');
  assertOperation('/api/books/{book_id}/exports/epub', 'get', '作品导出');
});

test('契约检查保留资产与 Scene Packet 关键字段，真实链路由 API pytest 执行', () => {
  assertSourceEvidence(apiTests.scenePacket, [
    'Book(',
    'Chapter(',
    'Scene(',
    'asset_type="character"',
    'asset_type="style_rule"',
    '"/api/scene-packets"',
    '林岚',
    '克制',
  ]);

  const assetCreateSchema = openapi.components.schemas.AssetCreate;
  assert.deepEqual(assetCreateSchema.required, ['book_id', 'asset_type', 'name']);

  const scenePacketSchema = openapi.components.schemas.ScenePacketRead;
  assert.ok(scenePacketSchema.properties.packet, 'Scene Packet 响应必须包含 packet');
  assert.ok(scenePacketSchema.properties.budget_statistics, 'Scene Packet 响应必须包含预算统计');
});

test('Judge 与 Repair 契约覆盖结构化问题单和定向修复补丁', () => {
  assertSourceEvidence(apiTests.judgeRepair, [
    '"/api/judge/issues"',
    '"/api/repair/patches"',
    'required_facts',
    'style_rules',
    'target_span',
    'replacement_text',
    'requires_rejudge',
  ]);

  const judgeSchema = openapi.components.schemas.JudgeIssueRead;
  assert.ok(judgeSchema.properties.category, 'Judge 响应必须包含 category');
  assert.ok(judgeSchema.properties.severity, 'Judge 响应必须包含 severity');
  assert.ok(judgeSchema.properties.status, 'Judge 响应必须包含 status');

  const repairSchema = openapi.components.schemas.RepairPatchRead;
  assert.ok(repairSchema.properties.target_span, 'Repair 响应必须包含 target_span');
  assert.ok(repairSchema.properties.replacement_text, 'Repair 响应必须包含 replacement_text');
});

test('契约检查标记批准回写服务边界和下一章继承证据', () => {
  assertSourceEvidence(apiTests.phase1ClosedLoopApi, [
    'test_phase1_closed_loop_api_with_writeback_service_boundary',
    'approve_chapter_writeback',
    'Phase 1 边界',
    'next_chapter_id',
    '/api/books/{phase1_story',
  ]);

  assertSourceEvidence(apiTests.phase1ClosedLoopApi, [
    '林岚必须隐藏伤势',
    '灯塔信号仍需保留',
    'exports/markdown',
    'exports/epub',
  ]);

  const approvalSchema = openapi.components.schemas.ChapterApprovalCreate;
  assert.ok(approvalSchema.properties.next_chapter_constraints, '批准请求必须允许写入下一章继承约束');
  assert.ok(approvalSchema.properties.character_state_changes, '批准请求必须允许写入角色状态变化');
});

test('契约检查确认导出链路只输出已批准正文并覆盖 Markdown 与 EPUB', () => {
  assertSourceEvidence(apiTests.exports, [
    'exports/markdown',
    'exports/epub',
    'approved_content',
    '没有可导出的已批准正文',
    '未批准场景不会出现在导出内容中',
    '按章节序号和场景序号稳定排序',
    'text/markdown',
    'application/epub+zip',
  ]);

  const markdown = assertOperation('/api/books/{book_id}/exports/markdown', 'get', '作品导出');
  const epub = assertOperation('/api/books/{book_id}/exports/epub', 'get', '作品导出');
  assert.ok(markdown.responses['200'], 'Markdown 导出必须提供 200 响应');
  assert.ok(epub.responses['200'], 'EPUB 导出必须提供 200 响应');
});
