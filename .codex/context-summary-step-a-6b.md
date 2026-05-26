## 项目上下文摘要（Step A-6b）

生成时间：2026-05-26 00:45:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/main.py`
  - 当前已有 `require_storyforge_api_key` HTTP middleware，统一返回 `JSONResponse`。
  - 当前已有 `_expected_api_key()`、`_cors_origins()`、`_rate_limit_key()` 这类环境/请求辅助函数。
  - A-6b 可沿用同文件 helper + middleware 模式。
- **实现2**: `apps/api/tests/test_api_middleware.py`
  - 当前使用 `TestClient(app)` 验证认证、CORS、slowapi 配置。
  - A-6b 可动态注册唯一慢路由并用合法 API key 触发业务链路。
- **实现3**: 本地检索
  - API 侧无已有 request timeout middleware，可新增最小实现。

### 2. 测试策略

- 动态注册 `/api/__test__/slow-timeout`，内部 `await asyncio.sleep(0.05)`。
- monkeypatch `STORYFORGE_REQUEST_TIMEOUT_SECONDS=0.01`。
- 带 `X-StoryForge-API-Key: local-dev-key` 请求，期望 504 与 `请求处理超时。`。

### 3. 边界

- 不修改 A-7 检索查询。
- 默认超时时间为 120 秒，环境变量非法或非正数时回退默认值。
