# StoryForge P0/P1 修复验证报告

生成时间：2026-06-11 01:18:00 +08:00

## 1. 需求字段完整性

- **目标**：按 P0 安全硬化、P1 可观测性、Provider 错误分类、低风险清理的顺序完成本轮修复。
- **范围**：Web API Key 与 IDE 命令 BFF、下载/导出/预览 `workspace_id` 作用域、ModelRun/BookRun 可观测性、Provider usage 与错误分类、重复 fixture 清理、Studio accept/reject 不持久化提示。
- **交付物**：代码、Alembic 迁移、OpenAPI 契约、shared types、Web/API/Workflow 测试、`.codex/context-summary-p0-p1-hardening.md`、`.codex/operations-log.md`、本验证报告。
- **审查要点**：不引入新认证框架；缺 `workspace_id` 返回 422、错域返回 403、不存在返回 404；`token_usage` 保持兼容；`generate_text()` 保持旧接口；Studio 仅提示本页标记不写回。

## 2. 交付物映射

- `apps/web/lib/api-client.ts`：声明 `server-only`，移除 Web 侧硬编码 `local-dev-key`，缺少 `STORYFORGE_API_KEY` 时抛中文配置错误。
- `apps/web/app/api/ide/commands/[commandId]/route.ts`、`apps/web/components/ide/commands/command-client.ts`：浏览器同源 BFF 调用 IDE command，不再动态导入服务端 API client。
- `apps/api/app/domains/artifacts/*`、`exports/*`、`book_runs/*`、`ide/*`：下载、详情、作品导出、BookRun 导出、IDE 预览均接入 `workspace_id` 作用域校验；IDE preview versions 按工作区过滤。
- `apps/web/app/artifacts/api.ts`、`apps/web/app/book-runs/api.tsx`、`apps/web/app/ide/page.tsx`、`apps/web/components/ide/url/ide-url-state.ts`：前端从已加载元数据或 URL state 传递 `workspace_id`。
- `apps/api/alembic/versions/20260610_0001_add_model_run_observability.py`、ModelRun/BookRun ORM/schema/service：新增 usage、成本、finish reason、错误分类、latency 聚合等观测字段。
- `apps/workflow/storyforge_workflow/provider_client.py`、`runtime/provider_adapter.py`、`runtime/provider_execution.py`、`runtime/runner.py`：保留 `generate_text()`，新增完整 Chat Completion 结果、真实 usage、Retry-After、错误 kind 和 sink payload。
- `apps/workflow/tests/fixtures/quality_cases/*`：删除未引用重复乱码 fixture，保留根目录 `tests/fixtures/quality_cases`。
- `packages/shared/src/contracts/storyforge.openapi.json`、`packages/shared/src/generated/api-types.ts`：已重新生成。

## 3. 本地验证结果

- `pnpm openapi`：通过，已生成 OpenAPI 契约。
- `pnpm --filter @storyforge/shared generate:types`：通过，已生成 shared API types。
- `pnpm --filter @storyforge/web test`：231/231 passed。
- `pnpm --filter @storyforge/web lint`：`tsc --noEmit` 通过。
- `cd apps/api && uv run pytest tests/test_artifacts.py tests/test_exports.py tests/test_book_exporter.py tests/test_ide_artifact_preview.py tests/test_model_runs.py tests/test_book_runs.py tests/test_alembic_heads.py -q`：59 passed，2 warnings。
- `cd apps/workflow && uv run pytest tests/test_provider_adapter.py tests/test_provider_fallback.py tests/test_runtime_runner.py tests/test_model_run_token_tracking.py tests/test_prose_static_check.py -q`：56 passed。
- `pnpm run lint`：退出码 0；Prettier 全部通过；ESLint 有 1 个非阻断 warning，位于 `apps/web/tests/home-page.test.tsx:320`，变量 `shell` 未使用。
- `pnpm run test`：退出码 0；Web 231 passed，shared typecheck 通过，API 536 passed / 1 skipped / 7 warnings，Workflow 258 passed。

## 4. 子代理与审计发现

- 子代理 `Darwin` 执行只读安全旁路审计，不写代码。
- 审计发现一：IDE Artifact Preview 的 versions 查询仅按 `lineage_key`，可能泄露其他工作区同 lineage 版本；已新增测试并修复为按 `resolve_artifact_workspace_id()` 过滤。
- 审计发现二：`GET /api/artifacts/{artifact_id}` 详情端点无 `workspace_id`，下载页相邻读取链路可绕过作用域；已收紧为必填 `workspace_id`，Web 详情读取也传递作用域。
- `Hooke`、`Linnaeus` 为交接摘要中的上一轮子代理，不是本轮新派发的活动 worker。

## 5. 工具与资料来源

- 使用 `sequential-thinking` 与 `shrimp-task-manager.process_thought` 完成问题分解、计划和结论记录。
- 使用 `desktop-commander` 做本地搜索与文件分析；使用 PowerShell/rg 作为补充。
- 使用 Context7 查询 FastAPI required query parameter 与 Next.js BFF / `server-only` 官方文档。
- 使用 `github.search_code` 做开源实现检索；结果参考价值有限，最终以本项目代码模式为主。

## 6. 风险与补偿计划

- `pnpm run lint` 仍报告 1 个 ESLint warning：`apps/web/tests/home-page.test.tsx:320` 未使用变量。该 warning 不影响退出码，且来自相邻测试代码；建议后续清理。
- API 全量测试中有第三方/既有 warning：Alembic `path_separator` deprecation、JWT 测试短 key warning、FastAPI/Starlette 422 常量 deprecation。均未阻断本轮交付，建议单独治理。
- 本轮安全边界仍是用户确认的 `workspace_id` 作用域参数，不等同完整用户级多租户授权；后续如引入用户身份，应在此基础上叠加用户/成员鉴权。

## 7. 评分

- **代码质量**：94/100。改动集中在现有 domain service/router、Web helper 和 workflow adapter，未新增大型框架。
- **测试覆盖**：95/100。覆盖缺参 422、错域 403、正确路径、历史旧契约更新、provider usage/error kind、迁移单 head 和全量测试。
- **规范遵循**：93/100。完成上下文摘要、操作日志、子代理审计、Context7/GitHub/desktop-commander 使用和本地验证；保留一个非阻断 lint warning。
- **需求匹配**：96/100。P0/P1/Provider/清理项均已落地，并额外闭合子代理发现的相邻安全旁路。
- **架构一致**：94/100。复用现有 FastAPI Query、domain service、readJson params、Provider adapter 和 OpenAPI 生成链路。
- **风险评估**：92/100。破坏性 `workspace_id` 契约已通过测试和 OpenAPI/types 显式化，剩余风险已记录。

## 8. 结论

综合评分：94/100。

明确建议：通过。当前实现满足本轮 P0/P1 修复计划，所有关键本地验证已通过；残留 warning 不阻塞交付，但建议进入后续清理队列。

审查结论已留痕，时间戳：2026-06-11 01:18:00 +08:00。

---

## 9. Q2 增量：结构化人工盲评 schema（2026-06-11 续）

- **目标**：闭合审计 §2 唯一剩余的纯代码项 Q2——将 `manual_read_gate` 自由字典升级为受校验的结构化盲评门禁，补上缺失的数值评分表。
- **契约设计**（向后兼容，旧 `manual_read_gate` 保留）：
  - `ManualReadDimensionScore`（`extra="forbid"`）：`dimension`（限定 6 个质量维度集合）、`score`（1–5 整数 Likert）、`comment`（≤500）。
  - `ManualReadReview`（`extra="forbid"`）：`status`(passed/failed/needs_revision)、`reviewer`、`reviewed_chapter_count`、`word_count`、`dimension_scores`（≥1，去重校验）、`overall_score`（缺省按维度均分自动计算）、`conclusion`、`blind`。
  - `BookRunProgressUpdate` 新增 `manual_read_review` 字段；service 写入 `progress["manual_read_review"]`。
  - 将 `manual_read_gate`、`manual_read_review` 纳入 `STICKY_PROGRESS_KEYS`，修复后续 progress patch 不带键即丢失的隐患。
  - exporter 新增盲评评分表投影。
- **收尾修复**：上一轮新增 import 引入两处 ruff `I001`（`exports/book_markdown_exporter.py`、`book_runs/router.py`），经核对 master 干净、属本批引入，已 `ruff --fix` 收口。
- **本地验证**：
  - `cd apps/api && uv run ruff check .`：All checks passed。
  - `cd apps/api && uv run pytest tests/test_book_runs.py tests/test_book_exporter.py tests/test_book_export_epub.py tests/test_exports.py tests/test_model_runs.py -q`：51 passed，1 warning。
  - `node scripts/generate-openapi.mjs` + `pnpm --filter @storyforge/shared generate:types`：契约/types 重新生成，OpenAPI 净新增（ManualRead 盲评 + O1 ModelRun 观测列 + S2 workspace_id），无删除项。
  - `pnpm --filter @storyforge/shared exec tsc --noEmit`：退出码 0。
  - `pnpm --filter @storyforge/web test`：231/231 passed（含新增 IDE command BFF 路由测试）。
  - `pnpm --filter @storyforge/web run lint`（`tsc --noEmit`）：退出码 0。
- **未联通能力**：完整 `pnpm e2e` 的真实 HTTP pytest 需起 docker 服务，本机服务未启动；本轮以 API/web 单元+契约测试与 OpenAPI/types 生成链路覆盖增量。

收尾时间戳：2026-06-11 10:55:00 +08:00。
