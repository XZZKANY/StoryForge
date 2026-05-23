import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const activeRoutes = ["studio", "refinery", "retrieval", "runs", "artifacts", "evaluations", "providers"] as const;
const removedRoutes = ["analytics", "collaboration", "commercial", "workspace", "quality", "world"] as const;
const textFilesWithoutEncodingDamage = [
  "../../TODO.md",
  "app/page.tsx",
  "app/retrieval/page.tsx",
  "app/runs/page.tsx",
  "app/artifacts/page.tsx",
  "app/evaluations/page.tsx",
  "app/studio/actions.tsx",
  "app/studio/api.ts",
  "app/studio/types.ts",
  "app/studio/validators.ts",
  "../api/app/domains/artifacts/__init__.py",
  "../../scripts/run-e2e.mjs",
] as const;

test("首页只保留真实数据流入口并删除占位页", () => {
  const home = read("app/page.tsx");
  for (const route of activeRoutes) {
    assert.ok(home.includes(`/${route}`), `应展示 /${route}`);
  }
  for (const route of removedRoutes) {
    assert.ok(!home.includes(`/${route}`), `不应继续展示占位入口 /${route}`);
    assert.ok(!existsSync(join(root, "app", route, "page.tsx")), `已删除 ${route} 页面`);
  }
});

test("根布局具备全局样式和错误加载边界", () => {
  assert.ok(read("app/layout.tsx").includes("./globals.css"), "layout 应导入 globals.css");
  assert.ok(read("app/globals.css").includes("--accent"));
  assert.ok(read("app/error.tsx").includes("页面暂时不可用"));
  assert.ok(read("app/loading.tsx").includes("正在加载 StoryForge 工作台"));
});

test("Retrieval 与 Runs 不再硬编码默认 ID", () => {
  const retrieval = read("app/retrieval/page.tsx");
  const runs = read("app/runs/page.tsx");
  assert.ok(retrieval.includes("searchParams"));
  assert.ok(retrieval.includes("book_id"));
  assert.ok(!retrieval.includes('url.searchParams.set("book_id", "1")'));
  assert.ok(runs.includes("searchParams"));
  assert.ok(runs.includes("job_run_id"));
  assert.ok(!runs.includes("defaultJobRunId = 1"));
});

test("页面复用 API client 并注入 API Key", () => {
  const client = read("lib/api-client.ts");
  const studioApi = read("app/studio/api.ts");
  const studioActions = read("app/studio/actions.tsx");
  const artifacts = read("app/artifacts/page.tsx");
  const evaluations = read("app/evaluations/page.tsx");
  const retrieval = read("app/retrieval/page.tsx");
  const runs = read("app/runs/page.tsx");

  assert.ok(client.includes("X-StoryForge-API-Key"));
  assert.ok(client.includes("buildApiUrl"));
  assert.ok(client.includes("export async function apiFetch"), "api-client 应暴露统一 apiFetch");
  assert.ok(client.includes("apiFetch(path"), "readJson 应复用 apiFetch，避免读写两套 header 逻辑");

  assert.ok(studioApi.includes("readJson"), "Studio GET 读取应复用 readJson");
  assert.ok(!studioApi.includes("fetch(new URL"), "Studio GET 读取不应保留裸 fetch(new URL(...))");
  assert.ok(studioActions.includes("apiFetch"), "Studio POST Server Action 应复用 apiFetch 注入 API Key");
  assert.ok(!studioActions.includes("fetch(new URL"), "Studio POST 不应绕过统一 API client");
  assert.ok(artifacts.includes("readJson"), "Artifacts 页面应复用 readJson");
  assert.ok(evaluations.includes("readJson"), "Evaluations 页面应复用 readJson");
  assert.ok(!artifacts.includes("fetch(new URL"), "Artifacts 页面不应保留裸业务 fetch");
  assert.ok(!evaluations.includes("fetch(new URL"), "Evaluations 页面不应保留裸业务 fetch");

  assert.ok(retrieval.includes("apiFetch"), "Retrieval 页面应复用 apiFetch 注入 API Key");
  assert.ok(runs.includes("readJson"), "Runs 页面应复用 readJson 校验响应");
  assert.ok(!retrieval.includes("await fetch("), "Retrieval 页面不应保留裸业务 fetch");
  assert.ok(!runs.includes("await fetch("), "Runs 页面不应保留裸业务 fetch");
});

test("Studio 保留 Server Action 写回闭环且 page 保持薄入口", () => {
  const page = read("app/studio/page.tsx");
  const actions = read("app/studio/actions.tsx");
  const api = read("app/studio/api.ts");
  const types = read("app/studio/types.ts");
  const validators = read("app/studio/validators.ts");
  const pageContent = read("app/studio/page-content.tsx");

  assert.ok(page.includes("./page-content"));
  assert.ok(page.split("\n").length < 20, "Studio page.tsx 应保持薄入口");
  assert.ok(actions.includes("approveStudioWritebackAction"));
  assert.ok(actions.includes('"use server"'));
  assert.ok(actions.includes("revalidatePath"));
  assert.ok(!actions.includes("function StudioPageContent"), "actions.tsx 不应继续承载 Studio 页面渲染");
  assert.ok(!actions.includes("function isStudio"), "actions.tsx 不应继续承载 Studio 类型守卫");
  assert.ok(api.includes("readStudioBooks"));
  assert.ok(api.includes("getStudioTarget"));
  assert.ok(types.includes("export type StudioBookListItem"));
  assert.ok(validators.includes("isStudioChapterGoal"));
  assert.ok(pageContent.includes("批准写回已提交"));
  assert.ok(pageContent.includes("form action={approveStudioWritebackAction}"));
});

test("产品文案不应夸大未联通能力", () => {
  const files = [
    "app/page.tsx",
    "app/artifacts/page.tsx",
    "app/evaluations/page.tsx",
    "../../README.md",
    "../../PROJECT_SUMMARY.md",
    "../api/app/domains/artifacts/__init__.py",
    "../../scripts/run-e2e.mjs",
  ] as const;
  const forbiddenPhrases = ["完整中心", "实验室", "统一管理", "全家桶", "完整交互式"] as const;

  for (const file of files) {
    const content = read(file);
    for (const phrase of forbiddenPhrases) {
      assert.ok(!content.includes(phrase), `${file} 不应把未联通能力描述为“${phrase}”`);
    }
  }
});

test("文本文件不应残留连续问号编码损坏或 UTF-8 BOM", () => {
  for (const file of textFilesWithoutEncodingDamage) {
    const content = read(file);
    assert.notEqual(content.charCodeAt(0), 0xfeff, `${file} 必须使用 UTF-8 无 BOM 编码`);
    assert.ok(!content.includes("???"), `${file} 不应包含连续问号编码损坏`);
  }
});
