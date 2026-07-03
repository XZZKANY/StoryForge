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

test('资产与 Scene Packet 契约保留关键请求与响应字段', () => {
  const assetCreateSchema = openapi.components.schemas.AssetCreate;
  assert.deepEqual(assetCreateSchema.required, ['book_id', 'asset_type', 'name']);

  const scenePacketCreateSchema = openapi.components.schemas.ScenePacketCreate;
  assert.deepEqual(scenePacketCreateSchema.required, [
    'book_id',
    'chapter_id',
    'scene_goal',
    'active_asset_ids',
    'token_budget',
  ]);

  const scenePacketSchema = openapi.components.schemas.ScenePacketRead;
  assert.ok(scenePacketSchema.properties.packet, 'Scene Packet 响应必须包含 packet');
  assert.ok(scenePacketSchema.properties.budget_statistics, 'Scene Packet 响应必须包含预算统计');
});

test('Judge 与 Repair 契约覆盖结构化问题单和定向修复补丁', () => {
  const judgeCreateSchema = openapi.components.schemas.JudgeIssueCreate;
  assert.ok(judgeCreateSchema.properties.required_facts, 'Judge 请求必须允许携带 required_facts');
  assert.ok(judgeCreateSchema.properties.style_rules, 'Judge 请求必须允许携带 style_rules');

  const judgeSchema = openapi.components.schemas.JudgeIssueRead;
  assert.ok(judgeSchema.properties.category, 'Judge 响应必须包含 category');
  assert.ok(judgeSchema.properties.severity, 'Judge 响应必须包含 severity');
  assert.ok(judgeSchema.properties.status, 'Judge 响应必须包含 status');

  const repairSchema = openapi.components.schemas.RepairPatchRead;
  assert.ok(repairSchema.properties.target_span, 'Repair 响应必须包含 target_span');
  assert.ok(repairSchema.properties.replacement_text, 'Repair 响应必须包含 replacement_text');
  assert.ok(repairSchema.properties.requires_rejudge, 'Repair 响应必须包含 requires_rejudge');
});

test('章节批准回写契约保留下一章继承与连续性字段', () => {
  const approvalSchema = openapi.components.schemas.ChapterApprovalCreate;
  assert.ok(
    approvalSchema.properties.next_chapter_constraints,
    '批准请求必须允许写入下一章继承约束',
  );
  assert.ok(approvalSchema.properties.character_state_changes, '批准请求必须允许写入角色状态变化');
  assert.ok(approvalSchema.properties.continuity_edges, '批准请求必须允许写入连续性边');

  const approvalReadSchema = openapi.components.schemas.ChapterApprovalRead;
  assert.ok(approvalReadSchema.properties.records, '批准响应必须包含回写记录');
  assert.ok(approvalReadSchema.properties.continuity_edge_count, '批准响应必须包含连续性边计数');
});

test('契约检查确认导出链路覆盖 Markdown 与 EPUB', () => {
  const markdown = assertOperation('/api/books/{book_id}/exports/markdown', 'get', '作品导出');
  const epub = assertOperation('/api/books/{book_id}/exports/epub', 'get', '作品导出');
  assert.ok(markdown.responses['200'], 'Markdown 导出必须提供 200 响应');
  assert.ok(epub.responses['200'], 'EPUB 导出必须提供 200 响应');
});
