## 项目上下文摘要（docker-prod-compose）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `docker-compose.yml`
  - 模式：基础服务和应用服务集中声明，基础服务已有 `healthcheck` 与 `depends_on.condition: service_healthy`。
  - 可复用：postgres、redis、minio 的健康检查格式和 5s/3s/5 次参数。
  - 需注意：api、web、workflow 在基础文件中写入开发环境变量，prod override 需要避免这些值覆盖生产 env_file。
- **实现2**: `docker-compose.prod.yml`
  - 模式：生产覆盖文件使用 `!reset []` 清空基础服务端口，并统一设置 restart、logging、deploy resources。
  - 可复用：`x-storyforge-logging` 锚点、服务级资源限制结构。
  - 需注意：原先强制读取 `.env.production`，本地缺失时 `docker compose config` 失败。
- **实现3**: `scripts/verify-local.ps1`
  - 模式：PowerShell 本地验证入口，使用 `Write-Info`、`Write-Ok`、`Write-Fail` 聚合失败状态。
  - 可复用：命令可用性检查、路径检查、Docker 状态检查和中文门禁输出。
  - 需注意：新增 Docker prod config/build/health 门禁应沿用同一失败聚合方式。

### 2. 项目约定

- **命名约定**: Node 脚本使用 camelCase；PowerShell 函数使用 `Verb-Noun`；Compose 服务名使用小写短横线或单词。
- **文件组织**: Docker 编排文件位于仓库根目录；验证脚本位于 `scripts/`；审计记录位于项目本地 `.codex/`。
- **导入顺序**: Node 脚本优先 `node:` 内置模块；本任务复用 PowerShell 验证脚本，不新增业务导入。
- **代码风格**: 中文日志；PowerShell 4 空格缩进；Compose 使用 YAML 两空格缩进。

### 3. 可复用组件清单

- `docker-compose.yml`: 基础服务、Dockerfile build 上下文、基础 healthcheck。
- `docker-compose.prod.yml`: 生产 logging 和 deploy resources 覆盖结构。
- `scripts/verify-local.ps1`: 本地验证门禁框架。
- `apps/web/tests/phase1-navigation.test.tsx`: 通过文本读取验证 compose healthcheck 的测试模式。

### 4. 测试策略

- **测试框架**: 本任务主要使用 Docker Compose CLI 与 PowerShell 本地验证脚本；现有 Web 测试使用 `node:test` 静态检查 compose 内容。
- **测试模式**: 先复现失败，再运行 `docker compose -f docker-compose.yml -f docker-compose.prod.yml config`；随后运行 `powershell -ExecutionPolicy Bypass -File ./scripts/verify-local.ps1`。
- **覆盖要求**: prod config 渲染、build 定义入口、api/web 健康检查、基础服务生产端口 reset。

### 5. 依赖和集成点

- **外部依赖**: Docker Compose v5.1.0，Context7 Docker Compose 文档确认 `config` 会合并文件、解析变量并展开模型。
- **内部依赖**: prod nginx 依赖 api/web `service_healthy`；web 依赖 api `service_healthy`。
- **集成方式**: 根 compose 文件通过 `-f docker-compose.yml -f docker-compose.prod.yml` 顺序合并。
- **配置来源**: `.env.production.example` 作为本地可验证默认 env_file，`.env.production` 作为真实生产覆盖文件。

### 6. 技术选型理由

- **为什么用这个方案**: 保持既有 prod override 分层结构，同时让未创建真实生产密钥文件的开发机也能执行 config 门禁。
- **优势**: 不触碰业务源码；验证入口可重复；真实 `.env.production` 存在时仍可覆盖模板值。
- **劣势和风险**: 依赖当前 Docker Compose 对 `!reset` 和 `env_file.required` 的支持，必须用本机 CLI 验证。

### 7. 关键风险点

- **并发问题**: 无。
- **边界条件**: `.env.production` 缺失、api/web 缺少 healthcheck、基础服务端口未清空。
- **性能瓶颈**: 默认静态门禁开销低；完整 Docker build 可能较慢，应通过参数显式触发。
- **安全考虑**: 不提交真实生产密钥，仅使用模板占位值支持 config 验证。
