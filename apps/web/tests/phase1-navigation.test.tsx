import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const activeRoutes = ["studio", "refinery", "retrieval", "runs", "artifacts", "evaluations", "providers"] as const;
const removedRoutes = ["analytics", "collaboration", "commercial", "workspace", "quality", "world"] as const;

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
  assert.ok(client.includes("X-StoryForge-API-Key"));
  assert.ok(client.includes("buildApiUrl"));
  assert.ok(read("app/retrieval/page.tsx").includes("buildApiUrl"));
  assert.ok(read("app/runs/page.tsx").includes("buildApiUrl"));
});

test("Studio 保留 Server Action 写回闭环且 page 保持薄入口", () => {
  const page = read("app/studio/page.tsx");
  const actions = read("app/studio/actions.tsx");
  assert.ok(page.includes("StudioPageContent"));
  assert.ok(page.split("\n").length < 20, "Studio page.tsx 应保持薄入口");
  assert.ok(actions.includes("approveStudioWritebackAction"));
  assert.ok(actions.includes('"use server"'));
  assert.ok(actions.includes("revalidatePath"));
  assert.ok(actions.includes("批准写回已提交"));
  assert.ok(actions.includes("form action={approveStudioWritebackAction}"));
});
