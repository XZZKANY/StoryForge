# 项目上下文摘要（PH2 工程计划）

生成时间：2026-05-14 00:00:00 +08:00

## 1. 相似实现分析

- `apps/api/app/domains/assets/router.py` 与 `apps/api/app/domains/assets/service.py`
  - 模式：每个领域独立 `router.py`、`schemas.py`、`service.py`、`models.py`，`main.py` 只做 `include_router` 注册。
  - 可复用：`Asset` 的 `lineage_key`、`version`、`payload` 已能承载世界观条目、风格规则、记忆快照等版本化资产。
  - 需注意：更新资产必须复制最新版本，不覆盖历史；PH2 的风格包和世界观条目应复用这一版本谱系思想。
- `apps/api/app/domains/continuity/models.py` 与 `apps/api/app/domains/scene_packets/service.py`
  - 模式：`ContinuityRecord` 保存跨章节事实，`ScenePacket` 组装固定槽位，服务层负责跨实体归属校验和预算裁剪。
  - 可复用：系列级记忆可以扩展 `ContinuityRecord` 的记录类型，世界观中心可以作为 Scene Packet 的上游输入。
  - 需注意：检索片段不能替代结构化真相源；PH2 仍以 PostgreSQL 结构化表和资产 payload 为事实源。
- `apps/workflow/storyforge_workflow/graph.py` 与 `apps/workflow/tests/test_generation_graph.py`
  - 模式：LangGraph `StateGraph`、`interrupt`、`InMemorySaver`、`InMemoryWorkflowStore` 组合出可暂停可恢复工作流。
  - 可复用：批量精修应新增独立批处理图，保持节点幂等和可审计检查点。
  - 需注意：人工审批点必须通过 `thread_id` 恢复，状态字段保持 JSON 可序列化。
- `apps/api/tests/test_phase1_closed_loop_api.py`
  - 模式：FastAPI `TestClient` + SQLite 内存库 + `get_session` 覆盖，真实 HTTP API 串联闭环。
  - 可复用：PH2 端到端验收应沿用这一测试方式，验证系列记忆、世界观条目、风格包、批量精修和质量指标贯通。
  - 需注意：测试必须本地可重复，不依赖外部 LLM、远程 CI 或人工验证。
- `apps/web/tests/phase1-navigation.test.tsx` 与 `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：使用 Node 内置测试做静态契约检查，避免新增前端重依赖。
  - 可复用：PH2 前端可先用源码契约测试覆盖世界观中心、风格包、批量精修、质量看板页面和组件。
  - 需注意：所有页面、测试描述和文案必须为简体中文，并避免损坏占位符。

## 2. 项目约定

- **命名约定**：Python 模块、函数、字段使用 snake_case；类名使用 PascalCase；React 组件使用 PascalCase；页面路径使用 kebab-case 或既有英文工作台名。
- **文件组织**：后端按领域目录组织；前端使用 Next.js App Router 的 `app/**/page.tsx`；跨端契约由 `scripts/generate-openapi.ps1` 生成到 `packages/shared/src/contracts/storyforge.openapi.json`。
- **导入顺序**：Python 文件保留 `from __future__ import annotations`，先标准库、再第三方、再项目内部；前端先框架导入，再组件导入，再常量。
- **代码风格**：服务层承载业务规则，路由层只做协议和异常转换；测试说明、注释、文档和用户可见文案使用简体中文。

## 3. 可复用组件清单

- `app.db.base.Base`、`IdMixin`、`TimestampMixin`、`VersionMixin`：所有新模型必须复用统一主键、时间戳和版本字段。
- `app.db.session.get_session`：所有新 API 路由继续使用统一数据库依赖。
- `Asset`、`EvidenceLink`：用于风格包、世界观条目、系列记忆快照和证据追溯。
- `ContinuityRecord`、`ScenePacket`：用于系列级记忆、章节继承和上下文包扩展。
- `JobRun`：用于批量精修任务状态、进度、错误和恢复入口。
- `JudgeIssue`、`RepairPatch`：用于质量指标、批量精修问题统计和修复率计算。
- `InMemoryWorkflowStore`、`WorkflowCheckpoint`：用于批量精修工作流测试和本地可审计检查点。
- `apps/web/scripts/phase1-contract-test.mjs`：用于扩展前端静态契约测试。

## 4. 测试策略

- **API 测试**：沿用 `apps/api/tests` 的 pytest + SQLite 内存库 + `TestClient` 模式，新增 PH2 API 测试。
- **Workflow 测试**：沿用 `apps/workflow/tests/test_generation_graph.py`，新增批量精修图测试，验证暂停、恢复、检查点和进度。
- **前端测试**：沿用 Node 内置测试与源码契约检查，新增 PH2 页面与组件断言，不新增 Playwright 或 Testing Library。
- **契约测试**：修改后运行 `pnpm openapi`，检查 OpenAPI 包含 PH2 新端点。
- **最终验证**：运行 `pnpm verify`、`pnpm test`、`pnpm e2e`；当前基线 `pnpm install --frozen-lockfile` 因本机 pnpm 版本 11.0.9 与项目 `packageManager` 9.15.4 不一致失败，需在实施前用项目指定 pnpm 或修正本地包管理器配置。

## 5. 依赖和集成点

- **外部依赖**：FastAPI、Pydantic、SQLAlchemy、LangGraph、Next.js、React；PH2 计划不新增运行时依赖。
- **内部依赖**：`apps/api/app/models.py` 需要注册新模型；`apps/api/app/main.py` 需要注册新路由；`apps/workflow/storyforge_workflow/__init__.py` 需要导出批量精修图；`apps/web/app/page.tsx` 需要增加新工作台入口。
- **配置来源**：数据库连接仍由 `apps/api/app/db/session.py` 的 `DATABASE_URL` 读取；本地验证由根 `package.json` 和 `scripts/verify-local.ps1` 统一编排。
- **OpenAPI**：新增 API 后必须更新 `packages/shared/src/contracts/storyforge.openapi.json`。

## 6. 技术选型理由

- 继续采用模块化单体：PH2 增强资产闭环，不引入微服务或事件平台，降低实施复杂度。
- 继续使用结构化数据库作为真相源：世界观、风格包、记忆快照和质量指标都必须可审计、可测试、可版本化。
- 批量精修放在 workflow：设计规格要求 Web API 不直接编排复杂多步写作流程，长任务应由 Workflow Runtime 管理。
- 前端先做契约工作台：当前项目尚无浏览器测试依赖，PH2 计划应优先复用静态契约测试，后续再增强交互测试。

## 7. 关键风险点

- **范围风险**：PH2 同时包含五个目标，必须分成可独立验证的任务，不能一次性大改。
- **迁移风险**：新增模型需同步 `app.models`、Alembic 迁移和 SQLite 测试元数据。
- **状态一致性风险**：系列级记忆与世界观条目可能重复表达同一事实，必须明确“资产为事实源、记忆为快照”的边界。
- **工作流恢复风险**：批量精修节点需要幂等，避免恢复时重复写补丁或重复统计。
- **验证风险**：当前 pnpm 版本不匹配会阻塞前端和根级验证；实施前必须修正本地包管理器版本或记录补偿计划。
- **工具限制**：本会话没有 `sequential-thinking`、`shrimp-task-manager`、`context7`、`github.search_code` 的直接入口；已使用 Codex 计划工具、本地 PowerShell 检索和官方网页文档作为替代，并在操作日志记录。

## 8. 官方资料核对

- FastAPI 官方文档：`APIRouter` 支持按模块拆分路径操作并由 `app.include_router()` 汇入主应用；`response_model` 用于响应文档、校验、转换与过滤。
- SQLAlchemy 官方文档：推荐基于 `Mapped` 注解、`mapped_column` 和 `relationship` 的现代 Declarative 映射。
- Pydantic 官方文档：`Field` 支持默认值和字段约束；`model_validator` 可做整体验证。
- LangGraph 官方文档：durable execution 依赖持久化检查点；`interrupt()` 需要 checkpointer、thread id 和 JSON 可序列化 payload。
- Next.js 官方文档：App Router 使用文件系统路由，`app/**/page.tsx` 默认导出页面组件。
