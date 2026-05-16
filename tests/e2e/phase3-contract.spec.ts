import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const openapi = JSON.parse(readFileSync("packages/shared/src/contracts/storyforge.openapi.json", "utf8"));
const apiTests = {
  workspaces: readFileSync("apps/api/tests/test_workspaces_api.py", "utf8"),
  collaboration: readFileSync("apps/api/tests/test_collaboration.py", "utf8"),
  commercial: readFileSync("apps/api/tests/test_commercial_controls.py", "utf8"),
  providerGateway: readFileSync("apps/api/tests/test_provider_gateway.py", "utf8"),
  analytics: readFileSync("apps/api/tests/test_phase3_analytics.py", "utf8"),
};
const webSources = {
  home: readFileSync("apps/web/app/page.tsx", "utf8"),
  workspace: readFileSync("apps/web/app/workspace/page.tsx", "utf8"),
  collaboration: readFileSync("apps/web/app/collaboration/page.tsx", "utf8"),
  commercial: readFileSync("apps/web/app/commercial/page.tsx", "utf8"),
  providers: readFileSync("apps/web/app/providers/page.tsx", "utf8"),
  analytics: readFileSync("apps/web/app/analytics/page.tsx", "utf8"),
};

function assertOperation(path, method, tag) {
  const operation = openapi.paths?.[path]?.[method];
  assert.ok(operation, `缺少 ${method.toUpperCase()} ${path}`);
  assert.ok(operation.tags?.includes(tag), `${path} 未归入 ${tag} 标签`);
}

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少 Phase 3 证据：${marker}`);
  }
}

test("Phase 3 OpenAPI 暴露工作区、协作、商业化、Provider Gateway、事件流和分析扩展端点", () => {
  assertOperation("/api/workspaces", "post", "团队工作区");
  assertOperation("/api/workspaces", "get", "团队工作区");
  assertOperation("/api/workspaces/{workspace_id}/members", "post", "团队工作区");
  assertOperation("/api/workspaces/{workspace_id}/members", "get", "团队工作区");
  assertOperation("/api/collaboration/comments", "post", "协作审批");
  assertOperation("/api/collaboration/approvals", "post", "协作审批");
  assertOperation("/api/collaboration/approvals/{approval_request_id}/decisions", "post", "协作审批");
  assertOperation("/api/collaboration/scenes/{scene_id}/timeline", "get", "协作审批");
  assertOperation("/api/events/workspaces/{workspace_id}", "get", "事件流");
  assertOperation("/api/commercial/workspaces/{workspace_id}/policy", "post", "商业化控制");
  assertOperation("/api/commercial/workspaces/{workspace_id}/summary", "get", "商业化控制");
  assertOperation("/api/provider-gateway/providers", "post", "模型接入层");
  assertOperation("/api/provider-gateway/providers", "get", "模型接入层");
  assertOperation("/api/provider-gateway/resolve", "get", "模型接入层");
  assertOperation("/api/analytics/workspaces/{workspace_id}/dashboard", "get", "分析扩展");
});

test("Phase 3 后端测试源码保留关键业务证据", () => {
  assertSourceEvidence(apiTests.workspaces, ['"/api/workspaces"', 'seat_limit', '席位已满']);
  assertSourceEvidence(apiTests.collaboration, ['"/api/collaboration/comments"', '"/api/collaboration/approvals"', 'approval_decided', 'comment_created']);
  assertSourceEvidence(apiTests.commercial, ['"/api/commercial/workspaces/', 'monthly_job_limit', 'monthly_token_limit', 'within_limits']);
  assertSourceEvidence(apiTests.providerGateway, ['"/api/provider-gateway/providers"', 'capabilities', 'claude-sonnet', 'gpt-5.5']);
  assertSourceEvidence(apiTests.analytics, ['"/api/analytics/workspaces/', 'approval_pass_rate', 'repair_acceptance_rate', 'failure_categories']);
});

test("Phase 3 前端入口包含工作区、协作、商业化、Provider Gateway 和分析扩展", () => {
  assertSourceEvidence(
    webSources.home,
    ["/workspace", "/collaboration", "/commercial", "/providers", "/analytics", "Workspace Hub 团队工作区", "Commercial Controls 商业化控制"],
  );
  assertSourceEvidence(webSources.workspace, ["成员席位", "作品归属", "商业化控制"]);
  assertSourceEvidence(webSources.collaboration, ["评论时间线", "审批请求", "审批决策", "协作事件"]);
  assertSourceEvidence(webSources.commercial, ["席位上限", "任务额度", "Token 额度", "套餐状态"]);
  assertSourceEvidence(webSources.providers, ["LLM", "Embedding", "Reranker", "图片生成或封面生成能力"]);
  assertSourceEvidence(webSources.analytics, ["审批通过率", "修复采纳率", "任务成功率", "Judge 失败类别", "事件流统计"]);
});
