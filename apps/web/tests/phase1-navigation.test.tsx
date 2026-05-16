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

const task7Files = [
  "app/page.tsx",
  "app/studio/page.tsx",
  "app/refinery/page.tsx",
  "app/assets/page.tsx",
  "app/jobs/page.tsx",
  "app/world/page.tsx",
  "app/quality/page.tsx",
  "components/scene-packet/ScenePacketPanel.tsx",
  "components/judge-panel/JudgeIssueList.tsx",
  "components/diff-viewer/RepairDiffViewer.tsx",
  "tests/phase1-navigation.test.tsx",
  "scripts/phase1-contract-test.mjs",
] as const;

test("Task 7 文件使用真实简体中文且没有损坏占位符", () => {
  for (const path of task7Files) {
    assertCleanChineseContract(path);
  }
});

test("首页导航可以进入 Studio、Refinery、Asset Center 和 Job Center", () => {
  const homePage = assertCleanChineseContract("app/page.tsx");
  assertIncludesAll(homePage, ["/studio", "/refinery", "/assets", "/jobs", "/world", "/quality"], "首页导航链接");
  assertIncludesAll(
    homePage,
    ["Studio 创作工作台", "Refinery 修订工坊", "Asset Center 素材中心", "Job Center 任务中心", "World Center 世界观中心", "Quality Dashboard 质量看板"],
    "首页导航标题",
  );
});

test("每个工作台页面都有明确中文标题", () => {
  const routeContracts = [
    ["app/studio/page.tsx", ["Studio 创作工作台", "生成链路", "ScenePacketPanel"]],
    ["app/refinery/page.tsx", ["Refinery 修订工坊", "文本对照", "评审问题", "修订差异"]],
    ["app/assets/page.tsx", ["Asset Center 素材中心", "素材清单", "章节计划"]],
    ["app/jobs/page.tsx", ["Job Center 任务中心", "任务状态", "继续处理"]],
    ["app/world/page.tsx", ["World Center 世界观中心", "角色与关系", "世界规则", "未回收伏笔", "跨书约束"]],
    ["app/quality/page.tsx", ["Quality Dashboard 质量看板", "开放问题", "修复采纳率", "任务成功率", "系列记忆覆盖"]],
  ] satisfies Array<readonly [string, readonly string[]]>;

  for (const [path, values] of routeContracts) {
    assertIncludesAll(assertCleanChineseContract(path), values, path);
  }
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
