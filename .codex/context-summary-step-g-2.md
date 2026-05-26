## 项目上下文摘要（Step G-2 Docker Compose healthcheck）

生成时间：2026-05-26 14:43:20

### 1. 相似实现分析

- **实现1**: `docker-compose.yml:13-17`
  - 模式：PostgreSQL 服务已使用 Compose `healthcheck`。
  - 可复用：`pg_isready -U storyforge -d storyforge` 探测命令。
  - 需注意：当前 `interval: 10s`、`timeout: 5s` 与计划要求不一致。
- **实现2**: `docker-compose.yml:26-30`
  - 模式：Redis 服务已使用数组形式 `test: ["CMD", "redis-cli", "ping"]`。
  - 可复用：Redis 官方 CLI 探测方式。
  - 需注意：当前 `interval: 10s`、`timeout: 5s` 与计划要求不一致。
- **实现3**: `apps/web/tests/phase1-navigation.test.tsx:44-50`
  - 模式：使用 Node 内置 `node:test` 与 `assert` 对根目录脚本做结构验证。
  - 可复用：`read("../../...")` 从 Web 测试读取仓库根文件。
  - 需注意：新增 Compose 结构验证应复用同一测试入口，避免引入新测试框架。

### 2. 项目约定

- **命名约定**: TypeScript 测试使用中文测试名称与 camelCase 局部变量；YAML 服务名使用小写服务名。
- **文件组织**: 根基础设施配置保留在 `docker-compose.yml`；结构测试保留在 `apps/web/tests/phase1-navigation.test.tsx`。
- **导入顺序**: Web 测试保持 Node 内置模块导入在文件顶部。
- **代码风格**: 两空格缩进、双引号字符串、中文断言消息。

### 3. 可复用组件清单

- `apps/web/scripts/phase1-contract-test.mjs`: 现有 Web 测试运行入口，会自动运行 `tests/*.test.tsx`。
- `apps/web/tests/phase1-navigation.test.tsx`: 现有跨文件结构测试，可读取 `../../docker-compose.yml`。
- `docker-compose.yml`: 现有 postgres/redis healthcheck 可复用，只需调整参数。

### 4. 测试策略

- **测试框架**: Node 内置 `node:test`，由 `apps/web/scripts/phase1-contract-test.mjs` 转译运行。
- **测试模式**: 静态结构测试先红灯，随后运行 Docker Compose 解析与容器健康状态验证。
- **参考文件**: `apps/web/tests/phase1-navigation.test.tsx`。
- **覆盖要求**: postgres、redis、minio 均有 healthcheck；interval 为 `5s`，timeout 为 `3s`，retries 为 `5`；MinIO 使用 `/minio/health/live`。

### 5. 依赖和集成点

- **外部依赖**: Docker Compose、PostgreSQL `pg_isready`、Redis `redis-cli`、MinIO 健康检查端点。
- **内部依赖**: 当前 compose 仅有 `postgres`、`redis`、`minio` 三个基础服务。
- **集成方式**: 通过 Docker Compose service healthcheck 由 Docker Engine 维护健康状态。
- **配置来源**: `docker-compose.yml`。

### 6. 技术选型理由

- **为什么用这个方案**: Compose 官方支持 `healthcheck` 的 `test`、`interval`、`timeout`、`retries` 字段；MinIO 官方文档提供 `/minio/health/live` 探测端点。
- **优势**: 不新增工具，不改变服务拓扑，直接提升本地服务就绪可见性。
- **劣势和风险**: MinIO 镜像内探测命令可用性必须通过实际容器验证确认。

### 7. 关键风险点

- **依赖等待**: 当前 compose 没有 api/web 等需要数据库的服务，因此没有可配置 `depends_on.postgres.condition: service_healthy` 的目标。
- **边界条件**: Docker 环境不可用或镜像缺少探测命令会导致运行时验证失败。
- **性能瓶颈**: `5s` 间隔的三个本地健康检查开销低。
- **工具约束**: GitHub `search_code` 工具在当前会话不可用，已通过 tool_search 记录无匹配工具；官方文档通过 Context7 查询 Docker Compose 与 MinIO。
