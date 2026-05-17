import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const openapi = JSON.parse(readFileSync("packages/shared/src/contracts/storyforge.openapi.json", "utf8"));
const apiTests = {
  retrieval: readFileSync("apps/api/tests/test_retrieval_index.py", "utf8"),
  scenePacketUpgrade: readFileSync("apps/api/tests/test_scene_packet_retrieval_upgrade.py", "utf8"),
  promptPacks: readFileSync("apps/api/tests/test_prompt_packs.py", "utf8"),
  modelRuns: readFileSync("apps/api/tests/test_model_runs.py", "utf8"),
  artifacts: readFileSync("apps/api/tests/test_artifacts.py", "utf8"),
  evaluations: readFileSync("apps/api/tests/test_evaluations.py", "utf8"),
};
const webSources = {
  home: readFileSync("apps/web/app/page.tsx", "utf8"),
  retrieval: readFileSync("apps/web/app/retrieval/page.tsx", "utf8"),
  runs: readFileSync("apps/web/app/runs/page.tsx", "utf8"),
  artifacts: readFileSync("apps/web/app/artifacts/page.tsx", "utf8"),
  evaluations: readFileSync("apps/web/app/evaluations/page.tsx", "utf8"),
};

function assertOperation(path, method, tag) {
  const operation = openapi.paths?.[path]?.[method];
  assert.ok(operation, `缺少 ${method.toUpperCase()} ${path}`);
  assert.ok(operation.tags?.includes(tag), `${path} 未归入 ${tag} 标签`);
}

function assertSourceEvidence(source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `缺少 Phase 4 证据：${marker}`);
  }
}

test("Phase 4 OpenAPI 暴露检索、Prompt Packs、模型运行日志、制品中心和评测端点", () => {
  assertOperation("/api/retrieval/sources", "post", "检索中心");
  assertOperation("/api/retrieval/refresh-runs", "post", "检索中心");
  assertOperation("/api/retrieval/search", "post", "检索中心");
  assertOperation("/api/prompt-packs", "post", "Prompt Packs");
  assertOperation("/api/model-runs", "post", "模型运行日志");
  assertOperation("/api/artifacts", "post", "制品中心");
  assertOperation("/api/evaluations/runs", "post", "评测系统");
});

test("Phase 4 后端测试源码保留关键业务证据", () => {
  assertSourceEvidence(apiTests.retrieval, ['"/api/retrieval/sources"', '"/api/retrieval/search"', "chunk_count", "source_ref"]);
  assertSourceEvidence(apiTests.scenePacketUpgrade, ['"/api/scene-packets"', "retrieval_hit", "检索命中"]);
  assertSourceEvidence(apiTests.promptPacks, ['"/api/prompt-packs"', "forbidden", "history"]);
  assertSourceEvidence(apiTests.modelRuns, ['"/api/model-runs"', "provider_name", "token_usage", "prompt_pack_id"]);
  assertSourceEvidence(apiTests.artifacts, ['"/api/artifacts"', "artifact_type", "upload"]);
  assertSourceEvidence(apiTests.evaluations, ['"/api/evaluations/cases"', '"/api/evaluations/runs"', "consistency_error_rate"]);
});

test("Phase 4 前端入口包含检索、运行日志、制品中心和评测面板", () => {
  assertSourceEvidence(
    webSources.home,
    ["/retrieval", "/runs", "/artifacts", "/evaluations", "Retrieval Center 检索中心", "Evaluation Lab 评测实验面板"],
  );
  assertSourceEvidence(webSources.retrieval, ["资料库", "Embedding 刷新任务", "检索命中与重排", "Scene Packet 检索证据"]);
  assertSourceEvidence(webSources.runs, ["模型运行日志", "Provider 解析结果", "Prompt Pack 来源", "任务恢复入口"]);
  assertSourceEvidence(webSources.artifacts, ["导出物", "上传资料", "工作流快照", "评测报告"]);
  assertSourceEvidence(webSources.evaluations, ["一致性错误率", "修复成功率", "用户接受率", "未回收 open loop"]);
});
