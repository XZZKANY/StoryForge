## 项目上下文摘要（Step G-1 生产默认凭据启动告警）

生成时间：2026-05-26 14:32:18 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/main.py`
  - 模式：集中创建 `FastAPI` app，定义中间件、限流器、健康检查、路由注册和 `DomainError` handler。
  - 可复用：`_expected_api_key()` 已封装 API Key 读取，默认值为 `local-dev-key`。
  - 需注意：当前没有 logger，也没有 startup hook。
- **实现2**: `apps/api/tests/test_api_middleware.py`
  - 模式：pytest + TestClient/monkeypatch 测试中间件和配置函数行为。
  - 可复用：`monkeypatch` 修改环境变量，断言应用配置行为。
  - 需注意：startup 日志更适合用 `caplog` 直接调用函数验证，避免 TestClient 生命周期和日志捕获不稳定。
- **实现3**: `.env.example`
  - 模式：本地开发默认值集中在根目录环境示例。
  - 可复用：`STORYFORGE_API_KEY=local-dev-key` 是 G-1 需要检测的默认凭据来源。
  - 需注意：本步骤只添加 warning，不改变认证行为。

### 2. 项目约定

- **命名约定**: Python 函数 snake_case，常量大写。
- **文件组织**: API 应用启动逻辑在 `app/main.py`，中间件测试在 `tests/test_api_middleware.py`。
- **导入顺序**: 标准库、第三方、项目内模块。
- **代码风格**: docstring 和错误/日志说明使用简体中文优先；计划指定英文 warning 文案，保留其字面内容。

### 3. 可复用组件清单

- `_expected_api_key()`: API Key 读取与默认值。
- `app.on_event("startup")`: FastAPI 启动 hook。
- `caplog`: pytest 日志断言。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: monkeypatch `STORYFORGE_ENV` 与 `STORYFORGE_API_KEY`，caplog 捕获 warning。
- **参考文件**: `apps/api/tests/test_api_middleware.py`。
- **覆盖要求**: 生产默认 key 产生 warning；development 默认 key 不告警。

### 5. 依赖和集成点

- **外部依赖**: FastAPI startup event。已通过 Context7 查询 FastAPI 文档，确认 `@app.on_event("startup")` 可注册启动函数，且 lifespan 是新推荐方式。
- **内部依赖**: `_expected_api_key()`。
- **集成方式**: `warn_default_credentials()` 注册到 app startup，并可由测试直接调用。
- **配置来源**: `STORYFORGE_ENV`、`STORYFORGE_API_KEY`。

### 6. 技术选型理由

- **为什么用这个方案**: 计划明确给出 startup event 形式，直接函数 + startup 注册满足可测性和计划要求。
- **优势**: 不改变请求鉴权路径，不引入新依赖，日志可通过 caplog 验证。
- **劣势和风险**: `on_event` 在 FastAPI 文档中属于 deprecated alternative；后续若项目迁移 lifespan，可把同一函数迁入 lifespan。

### 7. 关键风险点

- **并发问题**: 只在启动时读取环境变量并写日志，无共享状态。
- **边界条件**: `STORYFORGE_ENV=development` 不告警；未配置环境默认 development。
- **性能瓶颈**: 无。
- **安全考虑**: 仅添加告警，不改变认证或凭据处理行为。
