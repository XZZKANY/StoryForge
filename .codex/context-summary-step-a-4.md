## 项目上下文摘要（Step A-4）

生成时间：2026-05-26 00:05:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/main.py`
  - 模式：逐个 `from app.domains.<domain>.router import router as <domain>_router`，再调用 `app.include_router(<domain>_router)`。
  - 需注意：当前未导入/注册 analytics、collaboration、commercial、quality、workspaces。
- **实现2**: `apps/api/tests/test_api_surface.py`
  - 模式：从 `app.main import app`，收集 `{route.path for route in app.routes}` 后按 prefix 断言。
  - 需注意：当前测试反向断言五个目标 prefix 不存在，A-4 需要改为正向断言。
- **实现3**: 五个目标 `router.py`
  - `analytics`: prefix `/api/analytics`。
  - `collaboration`: prefix `/api/collaboration`。
  - `commercial`: prefix `/api/commercial`。
  - `quality`: prefix `/api/quality`。
  - `workspaces`: prefix `/api/workspaces`。

### 2. 项目约定

- **命名约定**: router alias 使用 `<domain>_router`。
- **文件组织**: 每个领域 router 自带 prefix/tags，主应用只负责 include。
- **测试策略**: API surface 测试只验证路由注册，不构造数据库请求。

### 3. 风险与边界

- 本步骤只注册 router，不修改 CORS、API key middleware 或业务服务。
- 所有新暴露 `/api/*` 路径会继承现有 API key middleware 行为。
