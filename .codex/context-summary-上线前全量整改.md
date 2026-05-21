## 项目上下文摘要（上线前全量整改）

生成时间：2026-05-21 12:40:00

### 1. 相似实现分析

- `apps/api/tests/conftest.py`：使用 FastAPI TestClient 与 SQLite 内存库覆盖 `get_session`，API 中间件测试沿用该模式。
- `apps/api/app/domains/provider_gateway/service.py`：provider 解析通过环境与数据库配置组合完成，workflow LLM 接入沿用环境配置思路。
- `apps/workflow/tests/test_generation_graph.py`：工作流测试通过 `InMemoryWorkflowStore` 与 LangGraph stream 验证节点顺序，新增 LLM 测试替身保持本地可重复。
- `apps/web/app/retrieval/page.tsx`、`apps/web/app/runs/page.tsx`：原有 Server Component 直接 fetch API，本轮抽取 `lib/api-client.ts` 统一 base URL 与 API Key 注入。

### 2. 项目约定

- Python 使用类型注解、中文 docstring、pytest。
- Web 使用 Next.js App Router、Server Component、中文界面文案。
- 工作流 checkpoint 只保存引用字段，避免完整上下文进入状态。

### 3. 可复用组件清单

- `get_session`：API 测试数据库依赖覆盖入口。
- `InMemoryWorkflowStore`：workflow 审计记录测试替身。
- `RuntimeCheckpointStore`：运行时 checkpoint 与 ModelRun 记录容器。
- `phase6DataSources`：前端数据源契约渲染来源。

### 4. 测试策略

- API：pytest + FastAPI TestClient。
- Workflow：pytest + LangGraph stream/resume 验证。
- Web：Node test 静态契约 + TypeScript `tsc --noEmit`。
- 新增测试覆盖 API Key/CORS、非受伤类 Judge 冲突、OpenAI 兼容 LLM HTTP 调用、Web 路由收缩和硬编码 ID 删除。

### 5. 依赖和集成点

- API Key 请求头：`X-StoryForge-API-Key`。
- CORS 默认允许 `http://localhost:3000` 与 `http://127.0.0.1:3000`。
- LLM 环境变量：`STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`。
- Judge 可选覆盖：`STORYFORGE_JUDGE_LLM_*`。

### 6. 技术选型理由

- 使用真实 `langgraph` 依赖，删除本地冒名 shim。
- 使用 OpenAI 兼容 Chat Completions 协议，避免绑定单一供应商 SDK。
- Web 先用轻量 CSS 和统一 API client，避免引入额外前端依赖。

### 7. 关键风险点

- 未配置真实 LLM 密钥时 workflow 会显式失败，不再伪装成功。
- checkpoint 仍有内存存储路径，生产持久化需要后续接入 Redis/PostgreSQL。
- Studio 已完成页面瘦身入口拆分，但 `actions.tsx` 仍需继续按职责迁移。
