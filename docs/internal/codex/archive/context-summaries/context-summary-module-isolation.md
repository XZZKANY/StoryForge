# 项目上下文摘要（模块隔离与评分）

生成时间：2026-05-24 15:30:00

## 1. 扫描范围

- 项目根目录：`D:/StoryForge/1-renovel-ai-ai-rag-tavern`
- 根结构：`apps/api`、`apps/web`、`apps/workflow`、`packages/shared`、`scripts`、`docs`、`tests`
- 任务性质：文档审查与模块评分，不修改业务代码。

## 2. 相似实现与代表性证据

- **API 领域路由聚合**：`apps/api/app/main.py`
  - 模式：FastAPI 单体入口按领域 router 注册。
  - 可复用：各 `app.domains.*.router` 是业务边界。
  - 需注意：`worldbuilding.router` 存在但未在入口注册，导致能力落地断开。
- **数据库模型汇总**：`apps/api/app/models.py`
  - 模式：统一导入所有 SQLAlchemy 模型，供 Alembic 与测试建表发现。
  - 可复用：`Base`、各领域模型、`__all__` 聚合。
  - 需注意：模型数量较多，迁移与聚合一致性需要持续验证。
- **Workflow 图编排**：`apps/workflow/storyforge_workflow/graph.py`
  - 模式：LangGraph `StateGraph` 串联 director、planner、beats、writer、approval。
  - 可复用：`_audited_node`、`_approval_node`、`InMemoryWorkflowStore`。
  - 需注意：多节点链路可审计，但真实 API/数据库桥接仍需要边界契约兜住。
- **引用型工作流状态**：`apps/workflow/storyforge_workflow/state.py`
  - 模式：checkpoint 只保存引用字段，避免全文进入状态。
  - 可复用：`GenerationState`、`checkpoint_reference_state`。
  - 需注意：这是上下文复杂度隔离的核心设计。
- **前端 API 网关**：`apps/web/lib/api-client.ts`
  - 模式：统一注入 `X-StoryForge-API-Key` 与 `cache: "no-store"`。
  - 可复用：`apiFetch`、`readJson`、`ApiResult<T>`。
  - 需注意：前端页面应统一经过该网关，避免散落 fetch。

## 3. 模块边界

| 模块 | 主要路径 | 职责 |
| --- | --- | --- |
| 核心 API / 业务真相源 | `apps/api/app/domains` | Studio、Scene Packet、Retrieval、Judge、Repair、Artifacts、Evaluations 等业务能力 |
| 数据库设计 | `apps/api/app/models.py`、`apps/api/alembic/versions`、`apps/api/app/db/session.py` | SQLAlchemy 模型、迁移、连接池与测试替身兼容 |
| Workflow / 多 Agent 编排 | `apps/workflow/storyforge_workflow` | LangGraph 生成链路、checkpoint、审批中断、模型调用边界 |
| 前端界面 | `apps/web/app`、`apps/web/components`、`apps/web/lib` | Next.js 页面、诊断入口、API 读取与展示 |
| 共享契约 | `packages/shared/src`、`packages/shared/src/contracts/storyforge.openapi.json` | TypeScript 类型与 OpenAPI 契约快照 |
| 自动化脚本 | `scripts/verify-local.ps1`、`scripts/run-e2e.mjs`、`scripts/generate-openapi.ps1` | 本地验证、E2E、OpenAPI 刷新 |
| 世界观设定 | `docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md`、`apps/api/app/domains/worldbuilding` | 产品设定、资产中心、世界规则、系列记忆聚合 |
| 测试体系 | `apps/api/tests`、`apps/workflow/tests`、`apps/web/tests`、`tests/e2e` | pytest、Node test、页面/契约验证 |

## 4. 关键集成点

- Web → API：`apps/web/lib/api-client.ts` 统一构造 URL、注入 API Key、关闭缓存。
- API → 数据库：`apps/api/app/db/session.py` 提供 `SessionLocal` 和请求级 `get_session()`。
- API → 领域模型：`apps/api/app/models.py` 导入所有领域模型，保证元数据可见。
- Workflow → 审计：`apps/workflow/storyforge_workflow/graph.py` 每个节点通过 store 记录输入输出摘要。
- Scene Packet → Retrieval / Context Compiler：`apps/api/app/domains/scene_packets/service.py` 会在缺少片段时检索，并调用 compiled context 附着逻辑。
- 世界观服务 → API 入口：`apps/api/app/domains/worldbuilding/router.py` 存在，但 `apps/api/app/main.py` 没有 include 该 router。

## 5. 测试策略

- 根脚本：`package.json` 定义 `pnpm verify`、`pnpm test`、`pnpm e2e`、`pnpm openapi`。
- API：`apps/api/tests` 使用 pytest 与 FastAPI TestClient，覆盖 Context Compiler、Retrieval、Scene Packet、ModelRun 等。
- Workflow：`apps/workflow/tests` 覆盖生成图、状态引用、LLM provider、runtime runner。
- Web：`apps/web/tests/phase1-navigation.test.tsx` 与根 `tests/e2e/*.spec.ts` 覆盖页面与契约读取。
## 6. 评分初步观察

- 最重、最容易恶心的区域：上下文编译、Scene Packet、Retrieval、Workflow 状态桥接。这些模块正确方向明确，但跨多个边界，调试成本最高。
- 相对扎实的区域：数据库模型/迁移、本地验证脚本、前端诊断入口、API 测试覆盖。
- 明显断点：世界观中心有 service/schema/router/test，但入口未注册且测试断言 404，说明该能力处于半隔离或未发布状态。
- 文档和实现方向一致：README 与设计文档都强调“可验证创作流水线”“资产驱动”“引用型状态”。

## 7. 上下文充分性检查

- 能说出至少 3 个相似实现路径：是，已分析 API 入口、Workflow 图、前端 API 网关、Context Compiler、自动化脚本等。
- 理解项目实现模式：是，模块化单体 + 领域 router + 共享契约 + 工作流服务。
- 知道可复用组件：是，`apiFetch`、`readJson`、`get_session`、`checkpoint_reference_state`、`compile_context`。
- 理解命名与风格：是，Python 使用 snake_case 与类型标注，TS 使用只读类型与函数式数据读取，文档使用中文。
- 知道如何验证：是，文档产物通过本地文件存在、关键章节、关键模块覆盖进行验证。
- 确认不重复造轮子：是，本任务只新增审查文档，不新增业务实现。
- 理解依赖和集成点：是，已列出 Web/API/DB/Workflow/契约/测试集成点。
