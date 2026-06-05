## 项目上下文摘要（源码剪枝 API 旧顶层 health）

生成时间：2026-06-05 15:25:44 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/main.py`
  - 模式：全局中间件通过 `_PUBLIC_PATHS` 跳过认证和限流，路由集中 include 到 `app`。
  - 可复用：保留 `health_router`，删除顶层 `@app.get("/health")`。
  - 需注意：从 `_PUBLIC_PATHS` 移除 `/health` 后，旧路径未认证请求会进入认证中间件，因此验收应以路由和 OpenAPI 不再注册为准。
- **实现2**: `apps/api/app/domains/health/router.py`
  - 模式：健康探针集中在 `APIRouter(prefix="/health")`，提供 `/health/live` 与 `/health/ready`。
  - 可复用：`/health/live` 证明进程存活，`/health/ready` 检查 DB、核心表和 Redis。
  - 需注意：不得修改 live/ready 行为。
- **实现3**: `apps/api/tests/test_health_probes.py`
  - 模式：使用 `TestClient` 和 mock 依赖验证 liveness/readiness。
  - 可复用：保留 live/ready 公开测试，将 legacy `/health` 测试替换为路由/OpenAPI 下线护栏。
  - 需注意：ready 依赖 mock 不应影响 live。
- **实现4**: `apps/api/tests/test_api_middleware.py`
  - 模式：使用 `/health` 证明公开、限流绕过和安全响应头。
  - 可复用：迁移到 `/health/live`，保留中间件验证语义。
  - 需注意：公开路径必须仍包含 `/health/live` 与 `/health/ready`。
- **实现5**: `apps/api/tests/test_source_pruning.py`
  - 模式：使用 `app.routes` 和 `app.openapi()` 验证已下线 API 不再注册。
  - 可复用：新增精确 `/health` 下线护栏，同时确认 `/health/live`、`/health/ready` 仍存在。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；pytest 测试函数以 `test_` 开头。
- **文件组织**: 健康域路由位于 `app/domains/health/router.py`，应用入口位于 `app/main.py`，源码剪枝护栏位于 `tests/test_source_pruning.py`。
- **导入顺序**: 标准库、第三方库、项目模块依次导入。
- **代码风格**: pytest + `TestClient`，中文测试说明和断言说明。

### 3. 可复用组件清单

- `apps/api/app/domains/health/router.py`: 当前健康探针事实源。
- `apps/api/app/main.py`: `_PUBLIC_PATHS`、全局中间件和路由注册事实源。
- `apps/api/app/common/metrics.py`: Prometheus 排除列表事实源。
- `scripts/verify-local.ps1`: 本地验证脚本已经检查 `/health/live`。
- `apps/api/Dockerfile`: 容器 liveness 探针已经使用 `/health/live`。
- `scripts/generate-openapi.mjs`: OpenAPI 与 shared generated 类型刷新入口。

### 4. 测试策略

- **测试框架**: pytest；共享包测试使用 `pnpm --filter @storyforge/shared test`。
- **测试模式**: 先调整测试并观察红灯，再删除旧路由和刷新契约。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_health_probes.py`、`tests/test_api_middleware.py`。
- **覆盖要求**: `/health` 不在 `app.routes` 和 OpenAPI；`/health/live`、`/health/ready` 仍公开；部署探针继续使用 `/health/live`；shared OpenAPI/generated types 不再包含精确 `/health`。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、prometheus-fastapi-instrumentator。
- **内部依赖**: `_PUBLIC_PATHS` 控制认证和限流绕过；`setup_metrics()` 控制 metrics 排除路径；OpenAPI 生成同步到 shared 包。
- **集成方式**: 删除旧顶层 route，保留 health router。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: `/health/live` 已承担旧 `/health` 的进程存活语义，`/health/ready` 承担依赖检查；部署和本地验证均不使用旧 `/health`。
- **优势**: 减少重复健康入口、OpenAPI 路径和客户端生成类型。
- **劣势和风险**: 旧 `/health` 直接访问不再是公开健康检查；需要依赖部署脚本已迁移到 `/health/live` 的证据。

### 7. 关键风险点

- **并发问题**: 无。
- **边界条件**: 不要求旧 `/health` HTTP 状态码为 404，避免被认证中间件返回 401 的实现细节干扰；只要求不注册路由和 OpenAPI。
- **性能瓶颈**: 删除路由和 metrics 排除项不会增加负担。
- **安全考虑**: 保留 live/ready 公开，受保护 API 认证逻辑不削弱。
