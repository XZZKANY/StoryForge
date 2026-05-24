# StoryForge 待办清单

## 环境配置

- 配置 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL` 与 `STORYFORGE_LLM_MODEL`，供本地 workflow 和 Judge 使用真实模型。
- 按部署环境设置 `STORYFORGE_API_KEY`，确保前端 Server Component 与 API 使用同一访问密钥。
- 为 workflow checkpoint 配置 `STORYFORGE_WORKFLOW_SQLITE_PATH`，必要时后续迁移到官方 PostgreSQL 或 Redis saver。

## 后续改进

- 持续收敛 Studio 页面模块边界，确保 `actions.tsx` 只保留 Server Action。
- 在生成 OpenAPI 后同步更新 `packages/shared/src/index.ts` 的客户端类型。
- 评估 Judge LLM provider 的生产观测字段，补充模型失败率和 fallback 命中率统计。

## 本地验证

- `pnpm run test:web`
- `pnpm run test:api`
- `pnpm run test:workflow`
- `pnpm run test`
- `pnpm run verify`

## 最近迭代记录

### 2026-05-24 Phase 7 发布治理到闭环验证

完成：
- 补齐 `.env.example` 本地默认项，新增 API Key、CORS、workflow SQLite 和 provider base URL 默认配置。
- 更新 `docs/operations/` 启动、发布、故障与 Alembic 文档，明确 `pnpm e2e` 固定执行真实 FastAPI HTTP pytest，不再接受补偿验收替代。
- 复验 Alembic 干净临时库从空库 `upgrade head` 到 `20260520_0001 (head)`。
- 复验 workflow-to-api ModelRun adapter 与 API 真表写入测试。
- 补强端到端冒烟测试，覆盖作品/章节/场景准备、Scene Packet、Judge、Repair、批准写回、导出和评测 run 详情读取。

验证方式：
- `pnpm verify`：通过。
- `uv run alembic upgrade head` + `uv run alembic current --check-heads`（临时库）：通过。
- `pnpm openapi`：通过，Worldbuilding Center 生成物 diff 已解释。
- `uv run pytest tests/test_worldbuilding_center.py tests/test_api_surface.py -q`：3 passed。
- `uv run pytest tests/test_runtime_runner.py tests/test_generation_state_references.py -q`：9 passed。
- `uv run pytest tests/test_model_runs.py -q`：10 passed。
- `pnpm verify && pnpm e2e`：通过。

下一步建议：
- 提交前确认 OpenAPI diff 与 Worldbuilding Center API 代码和测试一起提交。
- 后续若接入真实外部 LLM，只在本地私有 `.env` 配置真实密钥，不写入仓库。