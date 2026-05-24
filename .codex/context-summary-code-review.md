## 项目上下文摘要（Code Review）

生成时间：2026-05-24 20:00:00

### 1. 相似实现分析

- `apps/api/app/domains/studio/router.py`: FastAPI `APIRouter(prefix=...)` + `response_model` + 服务层异常转 HTTPException。
- `apps/api/app/domains/series/router.py`: 系列记忆路由按领域边界组织，服务层负责业务判断，路由层只做参数与状态码映射。
- `apps/api/app/domains/assets/router.py`: 资产 API 使用 `Query(gt=0)`、显式 response_model 和 404/400 转换。
- `apps/api/app/domains/scene_packets/retrieval_bridge.py`: Scene Packet 检索、ContextBlock、rerank metadata 的既有实现位置。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 当前测试通过 Node test + TypeScript 转译执行源码契约检查。

### 2. 项目约定

- Monorepo 使用 `pnpm-workspace.yaml` 管理 `apps/*` 与 `packages/*`。
- API 使用 FastAPI + SQLAlchemy + pytest，领域目录通常包含 `router.py`、`service.py`、`schemas.py`。
- Web 使用 Next.js App Router、React 19、TypeScript，页面读取通过本地封装 API 函数。
- 注释、测试描述与报告使用简体中文。

### 3. 可复用组件清单

- `apps/api/app/domains/scene_packets/retrieval_bridge.py`: `retrieval_context_blocks`、`build_retrieval_query`、`attach_compiled_context`。
- `apps/api/app/domains/scene_packets/context_pipeline.py`: 新增 `assemble_scene_context` 聚合检索、预算和 compiled context。
- `apps/web/app/studio/api.ts`: Studio 页面数据读取与端点常量。
- `apps/web/app/studio/actions.tsx`: Studio 批准写回 Server Action。

### 4. 测试策略

- 根命令：`pnpm test` 串联 Web、shared、API、workflow。
- Web：`pnpm --filter @storyforge/web test` 与 `pnpm --filter @storyforge/web lint`。
- API：`cd apps/api && uv run pytest`，测试使用 SQLite 内存库和 `TestClient`。
- 本轮完整门禁失败，需先修复后再重新验证。

### 5. 依赖和集成点

- `apps/api/app/main.py` 注册所有启用 API 路由，新增 worldbuilding router 后会进入全局 API Key 中间件。
- `apps/api/tests/test_api_surface.py` 维护启用/禁用路由表面契约。
- `apps/api/tests/test_scene_packet_retrieval_upgrade.py` 仍依赖旧私有导入 `_retrieval_context_blocks`。
- `apps/web/app/studio/page-content.tsx` 由服务端组件读取数据，再把步骤配置传入客户端 `StudioFlow`。

### 6. 外部资料

- Context7 查询了 `/vercel/next.js`：App Router 动态读取建议使用 `fetch(..., { cache: 'no-store' })`，Server Action mutation 后可 `refresh()`。
- Context7 查询了 `/fastapi/fastapi`：推荐使用 `include_router`/`APIRouter` 管理模块化路由与 response_model。
- 当前环境未暴露 `github.search_code` 工具，已作为检索限制记录。

### 7. 关键风险点

- 完整 `pnpm test` 失败，属于发布阻断。
- Web 新增流程测试偏源码字符串匹配，不能证明真实行为。
- `StudioFlow` 初次水合时可能立即滚动到非首个当前步骤。
- worldbuilding 对未知 `book_id` 的行为未被测试明确。
