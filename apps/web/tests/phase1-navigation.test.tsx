import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const assertIncludesAll = (content: string, values: readonly string[], label: string) => {
  for (const value of values) {
    assert.ok(content.includes(value), `${label} 必须包含：${value}`);
  }
};

const assertCleanChineseContract = (path: string) => {
  const content = read(path);
  assert.doesNotMatch(content, /\?{3,}/u, `${path} 不得包含连续问号占位`);
  assert.doesNotMatch(content, new RegExp("\\uFFFD", "u"), `${path} 不得包含替换字符`);
  assert.match(content, /[一-鿿]/u, `${path} 必须包含真实中文字符`);
  return content;
};

const uiContractFiles = [
  "app/page.tsx",
  "app/studio/page.tsx",
  "app/refinery/page.tsx",
  "app/assets/page.tsx",
  "app/jobs/page.tsx",
  "app/world/page.tsx",
  "app/quality/page.tsx",
  "app/workspace/page.tsx",
  "app/collaboration/page.tsx",
  "app/commercial/page.tsx",
  "app/providers/page.tsx",
  "app/analytics/page.tsx",
  "app/retrieval/page.tsx",
  "app/runs/page.tsx",
  "app/artifacts/page.tsx",
  "app/evaluations/page.tsx",
  "lib/phase6-data-sources.ts",
  "components/scene-packet/ScenePacketPanel.tsx",
  "components/judge-panel/JudgeIssueList.tsx",
  "components/diff-viewer/RepairDiffViewer.tsx",
  "tests/phase1-navigation.test.tsx",
  "scripts/phase1-contract-test.mjs",
] as const;

test("前端工作台文件使用真实简体中文且没有损坏占位符", () => {
  for (const path of uiContractFiles) {
    assertCleanChineseContract(path);
  }
});

test("首页导航覆盖 Phase 1、Phase 2 和 Phase 3 工作台入口", () => {
  const homePage = assertCleanChineseContract("app/page.tsx");
  assertIncludesAll(
    homePage,
    ["/studio", "/refinery", "/assets", "/jobs", "/world", "/quality", "/workspace", "/collaboration", "/commercial", "/analytics", "/providers"],
    "首页导航链接",
  );
  assertIncludesAll(
    homePage,
    [
      "Studio 创作工作台",
      "Refinery 修订工坊",
      "Asset Center 素材中心",
      "Job Center 任务中心",
      "World Center 世界观中心",
      "Quality Dashboard 质量看板",
      "Workspace Hub 团队工作区",
      "Collaboration 协作审批",
      "Commercial Controls 商业化控制",
      "Analytics Center 分析扩展",
      "Provider Gateway 模型接入层",
      "Retrieval Center 检索中心",
      "Run Center 运行日志中心",
      "Artifact Center 制品中心",
      "Evaluation Lab 评测实验面板",
    ],
    "首页导航标题",
  );
});

test("每个工作台页面都有明确中文标题和核心能力说明", () => {
  const routeContracts = [
    ["app/studio/page.tsx", ["Studio 创作工作台", "生成链路", "作品选择", "章节目标", "Scene Packet", "Judge 评审", "Repair 修订", "批准回写", "失败恢复", "ScenePacketPanel"]],
    ["app/refinery/page.tsx", ["Refinery 修订工坊", "文本对照", "评审问题", "修订差异"]],
    ["app/assets/page.tsx", ["Asset Center 素材中心", "素材清单", "章节计划"]],
    ["app/jobs/page.tsx", ["Job Center 任务中心", "任务状态", "继续处理"]],
    ["app/world/page.tsx", ["World Center 世界观中心", "角色与关系", "世界规则", "未回收伏笔", "跨书约束"]],
    ["app/quality/page.tsx", ["Quality Dashboard 质量看板", "开放问题", "修复采纳率", "任务成功率", "系列记忆覆盖"]],
    ["app/workspace/page.tsx", ["Workspace Hub 团队工作区", "成员席位", "作品归属", "商业化控制"]],
    ["app/collaboration/page.tsx", ["Collaboration 协作审批", "评论时间线", "审批请求", "审批决策", "协作事件"]],
    ["app/commercial/page.tsx", ["Commercial Controls 商业化控制", "席位上限", "任务额度", "Token 额度", "套餐状态"]],
    ["app/providers/page.tsx", ["Provider Gateway 模型接入层", "LLM", "Embedding", "Reranker", "图片生成或封面生成能力"]],
    ["app/analytics/page.tsx", ["Analytics Center 分析扩展", "审批通过率", "修复采纳率", "任务成功率", "Judge 失败类别", "事件流统计"]],
    ["app/retrieval/page.tsx", ["Retrieval Center 检索中心", "资料库", "资料来源类型", "Embedding 刷新任务", "搜索请求", "命中预览", "证据跳转", "检索命中与重排", "Scene Packet 检索证据"]],
    ["app/runs/page.tsx", ["Run Center 运行日志中心", "模型运行日志", "Provider 解析结果", "Prompt Pack 来源", "任务恢复入口", "Checkpoint 状态", "失败重试", "ModelRun adapter 契约"]],
    ["app/artifacts/page.tsx", ["Artifact Center 制品中心", "导出物", "导出下载", "上传资料", "资料入库状态", "工作流快照", "快照追溯", "评测报告", "报告追溯"]],
    ["app/evaluations/page.tsx", ["Evaluation Lab 评测实验面板", "评测集", "运行记录", "指标趋势", "失败样例", "一致性错误率", "修复成功率", "用户接受率", "未回收 open loop"]],
  ] satisfies Array<readonly [string, readonly string[]]>;

  for (const [path, values] of routeContracts) {
    assertIncludesAll(assertCleanChineseContract(path), values, path);
  }
});

test("Phase 6 工作台契约文档进入索引并区分交付状态", () => {
  const readProject = (path: string) => read(join("..", "..", path));
  const readme = readProject("README.md");
  const contract = readProject("docs/architecture/phase6-workbench-contract.md");

  assertIncludesAll(readme, ["Phase 6 工作台契约", "docs/architecture/phase6-workbench-contract.md"], "README 重要文档索引");
  assertIncludesAll(
    contract,
    ["Studio", "Retrieval", "Runs", "Artifacts", "Evaluations", "已实现的最小入口", "已有契约但未联通", "完全不存在", "竞品启发边界", "真实数据联动优先级", "最小 API 数据源契约", "Studio 数据源契约", "作品列表 API", "章节目标 API", "Scene Packet API", "Judge 评审 API", "Repair 修订 API", "批准回写 API", "失败恢复 API", "Retrieval 数据源契约", "资料源列表 API", "刷新任务 API", "搜索请求 API", "命中预览 API", "证据跳转 API", "重排状态 API", "Runs 数据源契约", "JobRun 状态 API", "Checkpoint 引用 API", "ModelRun 日志 API", "失败重试 API", "Artifacts 数据源契约", "导出物 API", "上传资料 API", "工作流快照 API", "评测报告 API", "Evaluations 数据源契约", "评测集 API", "评测运行 API", "指标趋势 API", "失败样例 API"],
    "Phase 6 工作台契约",
  );
});

test("Phase 6 页面从统一数据源契约读取真实联动前置", () => {
  const registry = assertCleanChineseContract("lib/phase6-data-sources.ts");
  const studio = assertCleanChineseContract("app/studio/page.tsx");
  const retrieval = assertCleanChineseContract("app/retrieval/page.tsx");
  const runs = assertCleanChineseContract("app/runs/page.tsx");
  const artifacts = assertCleanChineseContract("app/artifacts/page.tsx");
  const evaluations = assertCleanChineseContract("app/evaluations/page.tsx");

  assertIncludesAll(registry, ["export const phase6DataSources", "phase6FirstDataSourceSpike", "phase6DataSources.studio[0]", "page", "contractSection", "nextAction", "studio", "retrieval", "runs", "artifacts", "evaluations", "作品列表 API", "Web 单点读取已实现", "API 最小契约已实现", "失败恢复 API", "资料源列表 API", "重排状态 API", "JobRun 状态 API", "导出物 API", "评测集 API"], "Phase 6 数据源 registry");
  assertIncludesAll(registry, ["{ name: \"章节目标 API\", input: \"作品 ID、目标章节编号\", output: \"章节目标、上章摘要、连续性约束\", status: \"Web 单点读取已实现\" }"], "Studio 章节目标 registry 状态");
  assertIncludesAll(registry, ["{ name: \"Scene Packet API\", input: \"作品 ID、章节 ID、场景目标\", output: \"scene_packet_id、证据链接、上下文预算摘要\", status: \"Web 单点读取已实现\" }"], "Studio Scene Packet registry 状态");
  assertIncludesAll(registry, ["{ name: \"Judge 评审 API\", input: \"草稿或 draft_artifact_id、scene_packet_id\", output: \"问题列表、严重级别、位置和建议\", status: \"Web 单点读取已实现\" }"], "Studio Judge registry 状态");
  assertIncludesAll(registry, ["{ name: \"Repair 修订 API\", input: \"Judge 问题、草稿引用、修订策略\", output: \"修订文本、差异摘要、采纳建议\", status: \"Web 单点读取已实现\" }"], "Studio Repair registry 状态");
  assertIncludesAll(registry, ["{ name: \"资料源列表 API\", input: \"作品 ID、来源类型过滤\", output: \"用户上传、章节快照、系列记忆、Prompt Pack 来源列表\", status: \"Web 单点读取已实现\" }"], "Retrieval 资料源 registry 状态");
  assertIncludesAll(registry, ["{ name: \"刷新任务 API\", input: \"资料源 ID、刷新范围、embedding provider\", output: \"refresh run ID、chunk 引用、provider 元数据、刷新状态\", status: \"Web 单点读取已实现\" }"], "Retrieval 刷新任务 registry 状态");
  assertIncludesAll(registry, ["{ name: \"搜索请求 API\", input: \"查询文本、作品 ID、topK、reranker 开关\", output: \"search request ID、命中列表、score、rerank 顺序\", status: \"Web 单点读取已实现\" }"], "Retrieval 搜索请求 registry 状态");
  assertIncludesAll(registry, ["{ name: \"批准回写 API\", input: \"修订结果、审批决策、章节 ID\", output: \"已批准章节版本、回写状态、后续任务引用\", status: \"Web 单点读取已实现\" }"], "Studio 批准回写 registry 状态");
  assertIncludesAll(registry, ["{ name: \"失败恢复 API\", input: \"job_run_id、checkpoint 引用、失败节点\", output: \"可恢复步骤、错误摘要、重试入口状态\", status: \"Web 单点读取已实现\" }"], "Studio 失败恢复 registry 状态");
  assertIncludesAll(registry, ["{ name: \"JobRun 状态 API\", input: \"job_run_id 或作品/章节过滤\", output: \"当前节点、运行状态、错误摘要、恢复提示\", status: \"Web 单点读取已实现\" }"], "Runs JobRun registry 状态");
  assertIncludesAll(registry, ["{ name: \"Checkpoint 引用 API\", input: \"job_run_id、checkpoint ID\", output: \"scene_packet_id、compiled_context_id、model_run_id、恢复节点\", status: \"Web 单点读取已实现\" }"], "Runs Checkpoint registry 状态");
  assertIncludesAll(registry, ["{ name: \"ModelRun 日志 API\", input: \"job_run_id、provider 或状态过滤\", output: \"provider、model、token、latency、错误消息和 payload 摘要\", status: \"Web 单点读取已实现\" }"], "Runs ModelRun registry 状态");
  assertIncludesAll(registry, ["{ name: \"导出物 API\", input: \"作品 ID、章节 ID、导出类型\", output: \"artifact ID、文件名、版本、下载状态\", status: \"Web 单点读取已实现\" }"], "Artifacts 导出物 registry 状态");
  assertIncludesAll(registry, ["{ name: \"评测运行 API\", input: \"eval set ID、模型或版本过滤\", output: \"run ID、状态、开始/结束时间、关联制品\", status: \"Web 单点读取已实现\" }"], "Evaluations 评测运行 registry 状态");
  assertIncludesAll(studio, ["phase6DataSources.studio", "phase6FirstDataSourceSpike", "首个真实读取 spike", "读取输入", "读取输出", "失败态", "数据源契约", "source.name", "source.status"], "Studio 数据源契约渲染");
  assertIncludesAll(studio, ["/api/studio/books", "读取作品列表", "空列表", "可重试错误摘要"], "Studio 作品列表真实读取边界");
  assertIncludesAll(studio, ["/api/studio/chapter-goals", "读取章节目标", "上章摘要", "连续性约束", "章节目标 API 返回格式不符合预期"], "Studio 章节目标真实读取边界");
  assertIncludesAll(studio, ["/api/studio/scene-packets", "读取 Scene Packet", "证据数量", "上下文预算摘要", "Scene Packet API 返回格式不符合预期"], "Studio Scene Packet 真实读取边界");
  assertIncludesAll(studio, ["/api/studio/judge-reviews", "读取 Judge 评审", "评审分数", "关键问题", "Judge 评审 API 返回格式不符合预期"], "Studio Judge 评审真实读取边界");
  assertIncludesAll(studio, ["/api/studio/repair-patches", "读取 Repair 修订", "修订文本", "差异摘要", "采纳建议", "Repair 修订 API 返回格式不符合预期"], "Studio Repair 修订真实读取边界");
  assertIncludesAll(studio, ["/api/studio/approval-summary", "批准回写摘要", "可批准", "不可批准", "批准回写摘要 API 返回格式不符合预期"], "Studio 批准回写摘要真实读取边界");
  assertIncludesAll(studio, ["/api/studio/recovery-summary", "失败恢复摘要", "可恢复", "不可恢复", "失败恢复摘要 API 返回格式不符合预期"], "Studio 失败恢复摘要真实读取边界");
  assertIncludesAll(retrieval, ["phase6DataSources.retrieval", "数据源契约", "source.name", "source.status"], "Retrieval 数据源契约渲染");
  assertIncludesAll(retrieval, ["/api/retrieval/workbench/sources", "读取资料源列表", "资料源列表 API 返回格式不符合预期", "可重试错误摘要"], "Retrieval 资料源列表真实读取边界");
  assertIncludesAll(retrieval, ["/api/retrieval/workbench/refresh-runs", "读取刷新任务", "刷新任务 API 返回格式不符合预期", "Embedding"], "Retrieval 刷新任务真实读取边界");
  assertIncludesAll(retrieval, ["/api/retrieval/workbench/search", "搜索请求与命中预览", "证据跳转", "搜索请求 API 返回格式不符合预期"], "Retrieval 搜索与命中预览真实读取边界");
  assertIncludesAll(runs, ["phase6DataSources.runs", "数据源契约", "source.name", "source.status"], "Runs 数据源契约渲染");
  assertIncludesAll(runs, ["/api/model-runs/job-runs", "读取 JobRun", "JobRun 状态", "Checkpoint 引用", "ModelRun 摘要", "可重试错误摘要"], "Runs JobRun 真实读取边界");
  assertIncludesAll(artifacts, ["phase6DataSources.artifacts", "数据源契约", "source.name", "source.status"], "Artifacts 数据源契约渲染");
  assertIncludesAll(artifacts, ["/api/artifacts", "制品真实读取", "Artifact #", "关联任务", "未实现边界", "制品下载动作、指标趋势图和报告详情页仍未实现"], "Artifacts 导出物真实读取边界");
  assertIncludesAll(evaluations, ["phase6DataSources.evaluations", "数据源契约", "source.name", "source.status"], "Evaluations 数据源契约渲染");
  assertIncludesAll(evaluations, ["/api/evaluations/runs", "评测运行真实读取", "Evaluation Run #", "失败样例数量", "未实现边界", "评测报告下载、指标趋势图和报告详情页仍未实现"], "Evaluations 评测运行真实读取边界");
});

test("Studio SSR 读取链路并行化无依赖请求", () => {
  const studio = assertCleanChineseContract("app/studio/page.tsx");
  assertIncludesAll(
    studio,
    [
      "type StudioTarget",
      "function getStudioTarget",
      "readStudioScenePacket(target: StudioTarget | undefined)",
      "readStudioRepairPatches(scenePacketState: StudioScenePacketState)",
      "Promise.all([readStudioChapterGoal(studioTarget), readStudioScenePacket(studioTarget)])",
      "Promise.all([readStudioJudgeReview(scenePacketState), readStudioRepairPatches(scenePacketState)])",
    ],
    "Studio SSR 并行读取结构",
  );
});


test("ScenePacketPanel 展示证据链接", () => {
  const source = assertCleanChineseContract("components/scene-packet/ScenePacketPanel.tsx");
  assertIncludesAll(
    source,
    ["export function ScenePacketPanel", "证据链接", "evidenceLinks", "href", "章节计划证据", "林岚人物卡", "灯塔港地点卡"],
    "ScenePacketPanel",
  );
});

test("JudgeIssueList 展示严重级别和位置", () => {
  const source = assertCleanChineseContract("components/judge-panel/JudgeIssueList.tsx");
  assertIncludesAll(
    source,
    ["export function JudgeIssueList", "严重级别", "位置", "severity", "location", "第 3 段第 2 句"],
    "JudgeIssueList",
  );
});

test("RepairDiffViewer 展示原文与修订文本", () => {
  const source = assertCleanChineseContract("components/diff-viewer/RepairDiffViewer.tsx");
  assertIncludesAll(
    source,
    ["export function RepairDiffViewer", "原文", "修订文本", "originalText", "revisedText"],
    "RepairDiffViewer",
  );
});
