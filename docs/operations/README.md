# StoryForge 运维文档索引

更新时间：2026-09-28

## 1. 使用方式

本目录收纳 StoryForge 本地启动、发布、故障排查和迁移验证相关文档。当前默认开发入口是 Desktop IDE，API 作为本地 sidecar 和业务事实源；旧 Web 与独立 Workflow 入口均已退役。后续代理接手发布治理时，应优先阅读本索引，再进入具体手册。

当前本地仓库路径为 `D:/StoryForge`。所有本地验证结论必须基于可重复命令，并写入 `.codex/verification-report.md`。

## 2. 文档列表

| 文档 | 用途 | 何时阅读 |
| --- | --- | --- |
| `local-start.md` | 本地工具、环境文件、Docker 服务、依赖安装、Desktop IDE 默认启动、`pnpm verify`、`pnpm e2e`、`pnpm test` 和 `pnpm openapi` 验证顺序。 | 新机器启动、环境重建、首次接手项目、复跑本地门禁。 |
| `troubleshooting.md` | Docker、API pytest、Alembic 多 head、OpenAPI、provider 未配置、`pnpm verify` 和 Git 工作区故障排查；远端 E2E 仅作历史案例。 | 本地验证失败或环境行为不确定时。 |
| `alembic-validation.md` | Alembic 迁移图、当前 head、离线 SQL 和在线数据库验证方法。 | 处理数据库迁移、升级或发布前数据库门禁时。 |
| `release-checklist.md` | 发布前 Git、环境、OpenAPI、测试、文档和回滚门禁。 | 准备提交、推送、发布或交接前。 |

## 3. 推荐阅读顺序

1. `local-start.md`：先确认本地环境、基础服务和常用本地门禁。
2. `troubleshooting.md`：若 `pnpm verify`、`pnpm e2e` 或 API pytest 失败，先按故障手册定位。
3. `alembic-validation.md`：涉及数据库迁移、Alembic head 或发布前数据库门禁时阅读。
4. `release-checklist.md`：最后按清单确认是否具备提交、推送、发布或交接条件。

## 4. 当前门禁边界

- `pnpm verify` 是提交前总门禁：lint、Desktop typecheck、shared / project-core / frontend 测试、API pytest（含 `tests/test_alembic_heads.py` 的 Alembic 单 head 预检）、Ruff、daily 档 sidecar smoke 与 OpenAPI 漂移检查。FastAPI HTTP pytest 失败是发布红灯，修复后复跑对应 pytest 与 `pnpm verify`，不得切换到服务层补偿验收。
- `pnpm e2e` 只做 OpenAPI 刷新/漂移检查和 Node 契约断言（秒级）；它不执行 HTTP pytest 或历史所称的 API verification，那些属于 `pnpm verify` / `pnpm test`。
- `pnpm verify` 不要求 Docker 探活；Docker 服务由默认开发入口 `pnpm dev`（Tauri 主进程或 `scripts/dev-start.mjs` maintenance 入口）负责检查和迁移。单机无 Docker 开发用 `STORYFORGE_DESKTOP_SKIP_SERVICES=1`（SQLite），详见 `local-start.md` 与 `apps/desktop/USAGE.md`。
- `pnpm openapi` 会按 `uv`、`python3`、`python` 顺序选择可用运行时；三者都不可用时才会失败。
- 远端 GitHub Actions CI/E2E 已于 2026-06-30 退役，当前没有远端自动门禁，以本地 `pnpm verify` / `pnpm e2e` 为准。
- `.env.example` 已包含 `STORYFORGE_API_KEY`、`STORYFORGE_API_BASE_URL`、`STORYFORGE_LLM_*`、`STORYFORGE_EMBEDDING_*`、`STORYFORGE_RERANKER_*` 和 `STORYFORGE_RAG_*`；缺少真实私有配置时只能验证回退路径，不能作为真实外部 AI/RAG 端到端已接入的发布依据。
- 真实 LLM 1 章、3 章与 10 章 smoke 已有脱敏证据；10 章 smoke 证据目录为 `.codex/real-llm-10ch-20260604-110831`，最终门禁为 `gate: pass_for_real_10ch_final_acceptance`；真实 3-5 万字长程仍未完成。

## 5. 2026-06 历史证据（原样保留，仅时点参考）

> 以下条目为 2026-06-04 时点的原始记录，其中的命令归属表述（如「`pnpm e2e` 的 API verification」）以当时脚本为准，与第 4 节的当前职责划分不一致时以第 4 节为准。GitHub Actions 远端 workflow 已于 2026-06-30 退役。

- 远端 `CI` run `26857864662` 已成功，但只覆盖 `CI / Core verification` 子集，不等于远端 E2E 总门禁通过。
- 历史远端 `E2E` run `26915457170`（2026-06-03T21:55:39Z）曾失败于 Alembic `Multiple head revisions`。
- 本地已新增 Alembic merge revision `20260604_0001`，并将 `tests/test_alembic_heads.py` 纳入本地 `pnpm e2e` 的 API verification 预检；在线 PostgreSQL 迁移已在本轮复验，临时库 `storyforge_phase9_online_verify` 执行 `uv run alembic upgrade head` 与 `uv run alembic current --check-heads` 均退出码为 0；修复已合入远端 `master`，最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z）已通过。
- 2026-06-04 时点 Docker Desktop 已启动并完成上述在线 PostgreSQL 迁移复验；该结果不随时间自动保鲜，复跑以当前环境实测为准。

## 6. 维护规则

- 新增运维文档后，必须在本索引中登记。
- 修改启动、发布、迁移或故障流程后，必须同步检查 `README.md` 的重要文档入口。
- 发布门禁或验证状态变化后，同步 `README.md`、`docs/internal/current-phase.md`、`docs/internal/TODO.md`、`docs/internal/PROJECT_SUMMARY.md` 和本目录相关手册；`docs/internal/dev-plan.md` 等历史文件只做带日期的追加记录，不回写改写历史正文。
- 所有验证结论必须写入 `.codex/verification-report.md`。
