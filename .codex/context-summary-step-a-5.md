## 项目上下文摘要（Step A-5）

生成时间：2026-05-26 00:16:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/main.py`
  - 当前 `CORSMiddleware` 使用 `_cors_origins()`，`allow_credentials=True`，`allow_methods=["*"]`，`allow_headers=["*"]`。
  - A-5 仅修改 methods 和 headers，不触碰 origins、credentials、API key middleware。
- **实现2**: `apps/api/tests/test_api_middleware.py`
  - 当前测试覆盖 API Key 拒绝、健康检查公开和 CORS 预检公开。
  - A-5 应新增 allowlist 测试，继续使用 `TestClient(app)`。
- **实现3**: Context7 FastAPI CORS 文档
  - `CORSMiddleware` 支持 `allow_methods` 和 `allow_headers`；使用 credentials 时应显式指定，不应使用通配符。

### 2. 测试策略

- 发送 OPTIONS preflight 到 `/api/workspaces`。
- 断言 `access-control-allow-methods` 包含计划内方法且不含 `PUT`。
- 断言 `access-control-allow-headers` 包含计划内 headers 且不含 `x-debug-token`。

### 3. 边界

- 不实现 A-6 rate limiting 或 request timeout。
