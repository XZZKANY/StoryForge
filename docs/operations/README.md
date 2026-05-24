# StoryForge 运维文档索引

更新时间：2026-05-18 17:10:00 +08:00

## 1. 使用方式

本目录收纳 StoryForge 本地启动、发布、故障排查和迁移验证相关文档。后续代理接手发布治理时，应优先阅读本索引，再进入具体手册。

## 2. 文档列表

| 文档 | 用途 | 何时阅读 |
| --- | --- | --- |
| `local-start.md` | 本地工具、环境文件、Docker 服务、依赖安装和验证顺序。 | 新机器启动、环境重建、首次接手项目。 |
| `release-checklist.md` | 发布前 Git、环境、OpenAPI、测试、文档和回滚门禁。 | 准备提交、推送、发布或交接前。 |
| `troubleshooting.md` | Docker、FastAPI HTTP pytest、OpenAPI、provider 未配置、`pnpm verify` 和 Git 工作区故障排查。 | 本地验证失败或环境行为不确定时。 |
| `alembic-validation.md` | Alembic 迁移脚本、head、离线 SQL 和在线数据库验证状态。 | 处理数据库迁移、升级或发布前数据库门禁时。 |

## 3. 推荐阅读顺序

1. `local-start.md`：先确认本地环境和基础服务。
2. `troubleshooting.md`：若任何命令失败，先按故障手册定位。
3. `alembic-validation.md`：涉及数据库或发布前迁移门禁时阅读。
4. `release-checklist.md`：最后按清单确认是否具备发布条件。

## 4. 当前已知限制

- 当前环境中 Docker 服务不可查询时，`pnpm verify` 会失败；需要启动 Docker Desktop 或 Docker 服务后补跑。
- `pnpm openapi` 会按 `uv`、`python3`、`python` 顺序选择可用运行时；三者都不可用时才会失败。
- FastAPI HTTP pytest 是 `pnpm e2e` 的固定发布门禁；失败时必须修复，不再切换到服务层补偿验收。
- `.env.example` 已包含 `STORYFORGE_API_KEY`、`STORYFORGE_API_BASE_URL`、`STORYFORGE_WORKFLOW_SQLITE_PATH`、`STORYFORGE_LLM_*`、`STORYFORGE_EMBEDDING_*`、`STORYFORGE_RERANKER_*` 和 `STORYFORGE_RAG_*`；其中 Provider Gateway 会读取 LLM、embedding、reranker 变量，缺少密钥时稳定回退，不能作为真实外部 AI/RAG 端到端已接入的发布依据。

## 5. 维护规则

- 新增运维文档后，必须在本索引中登记。
- 修改启动、发布、迁移或故障流程后，必须同步检查 `README.md` 的重要文档入口。
- 所有验证结论必须写入 `.codex/verification-report.md`。
