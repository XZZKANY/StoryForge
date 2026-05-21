import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const activeRoutes = ["studio", "refinery", "retrieval", "runs", "artifacts", "evaluations", "providers"] as const;
const removedRoutes = ["analytics", "collaboration", "commercial", "workspace", "quality", "world"] as const;

test("首页只展示真实数据流或接入职责入口", () => {
  const home = read("app/page.tsx");
  for (const route of activeRoutes) {
    assert.ok(home.includes(`/${route}`), `首页必须包含 /${route}`);
  }
  for (const route of removedRoutes) {
    assert.ok(!home.includes(`/${route}`), `首页不得继续指向已删除占位页 /${route}`);
    assert.ok(!existsSync(join(root, "app", route, "page.tsx")), `占位页 ${route} 必须删除`);
  }
});

test("根布局导入全局样式并提供错误与加载边界", () => {
  assert.ok(read("app/layout.tsx").includes("./globals.css"), "layout 必须导入 globals.css");
  assert.ok(read("app/globals.css").includes("StoryForge") || read("app/globals.css").includes("--accent"));
  assert.ok(read("app/error.tsx").includes("页面暂时不可用"));
  assert.ok(read("app/loading.tsx").includes("正在加载 StoryForge 工作台"));
});

test("Retrieval 和 Runs 页面不再硬编码固定 ID", () => {
  const retrieval = read("app/retrieval/page.tsx");
  const runs = read("app/runs/page.tsx");
  assert.ok(retrieval.includes("searchParams"));
  assert.ok(retrieval.includes("book_id"));
  assert.ok(!retrieval.includes('url.searchParams.set("book_id", "1")'));
  assert.ok(runs.includes("searchParams"));
  assert.ok(runs.includes("job_run_id"));
  assert.ok(!runs.includes("defaultJobRunId = 1"));
});

test("前端使用统一 API client 注入 API Key", () => {
  const client = read("lib/api-client.ts");
  assert.ok(client.includes("X-StoryForge-API-Key"));
  assert.ok(client.includes("buildApiUrl"));
  assert.ok(read("app/retrieval/page.tsx").includes("buildApiUrl"));
  assert.ok(read("app/runs/page.tsx").includes("buildApiUrl"));
});
