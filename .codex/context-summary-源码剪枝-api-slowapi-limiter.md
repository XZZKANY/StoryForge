## 项目上下文摘要（源码剪枝 API SlowAPI Limiter 空壳）

生成时间：2026-06-05 16:55:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_source_pruning.py`
  - 模式：通过读取源码文件和契约文件，防止旧兼容入口、包级转导出或未使用依赖回潮。
  - 可复用：`API_ROOT`、`read_text(encoding="utf-8")` 和禁用符号列表。
  - 需注意：安全和限流护栏必须同时确认真实路径仍存在。
- **实现2**: `apps/api/app/main.py`
  - 模式：认证、请求超时、分层限流、CORS、安全响应头和 router 注册集中在应用入口。
  - 可复用：`_rate_store`、`_rate_strategy`、`FixedWindowRateLimiter`、`parse_limit`、`enforce_tiered_rate_limit` 是当前真实限流路径。
  - 需注意：不删除认证、健康探针公开路径、metrics 或安全响应头。
- **实现3**: `apps/api/tests/test_api_middleware.py`
  - 模式：直接验证分层限流、429、健康检查绕过限流、CORS、认证和安全响应头。
  - 可复用：作为清理 SlowAPI 空壳后的行为护栏。
  - 需注意：测试直接使用 `_rate_store` 和 `_rate_strategy`，没有依赖 SlowAPI。

### 2. 项目约定

- **命名约定**: Python 私有变量使用 `_` 前缀，pytest 用例使用 `test_` 前缀。
- **文件组织**: API 剪枝护栏集中在 `apps/api/tests/test_source_pruning.py`。
- **导入顺序**: 标准库在前，第三方库和项目模块分组导入。
- **代码风格**: pytest plain `assert`，测试说明和断言消息使用简体中文。

### 3. 可复用组件清单

- `apps/api/app/main.py`: 真实认证、限流、中间件和 router 注册事实源。
- `apps/api/tests/test_api_middleware.py`: 分层限流和安全响应头行为测试。
- `apps/api/tests/test_health_probes.py`: 健康探针行为测试。
- `apps/api/tests/test_metrics.py`: metrics 行为测试。
- `apps/api/pyproject.toml` 与 `apps/api/uv.lock`: API Python 依赖事实源。

### 4. 测试策略

- **测试框架**: pytest，经 `uv run pytest` 或根目录 `pnpm run test:api` 调用。
- **测试模式**: 先新增 source-pruning 红灯，确认 SlowAPI 空壳和依赖残留仍存在；再删除空壳和依赖形成绿灯。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_api_middleware.py`。
- **覆盖要求**: SlowAPI 空壳删除、真实 limits 分层限流保留、健康探针/CORS/认证/安全响应头/metrics 不退化、依赖锁文件无残留。

### 5. 依赖和集成点

- **外部依赖**: `slowapi` 待删除；`limits` 继续保留并作为真实限流依赖。
- **内部依赖**: `_rate_store` 和 `_rate_strategy` 被测试夹具与中间件使用。
- **集成方式**: 删除未消费的 `Limiter` 空壳，不改变 `enforce_tiered_rate_limit`。
- **配置来源**: API Key、CORS、请求超时和环境配置不变。

### 6. 技术选型理由

- **为什么用这个方案**: `Limiter` 只写入 `app.state.limiter` 并对 health router 调用 `exempt`，但没有任何 `@limiter.limit` 或消费者；真实限流已经由 `limits.FixedWindowRateLimiter` 执行。
- **优势**: 减少未使用依赖和应用入口空壳，降低维护面。
- **劣势和风险**: 删除限流相关名称风险敏感，必须用中间件和健康探针测试验证安全边界。

### 7. 关键风险点

- **并发问题**: `_rate_store` 仍为内存限流存储，本批不改变其并发语义。
- **边界条件**: 健康检查和 OPTIONS 继续通过 `_PUBLIC_PATHS` 与 method 判断绕过认证和限流。
- **性能瓶颈**: 删除未使用 SlowAPI 导入减少启动导入面。
- **安全考虑**: 不削弱认证、CORS、限流、请求超时、安全响应头或 metrics。
