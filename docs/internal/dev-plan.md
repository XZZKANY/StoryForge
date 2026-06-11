# StoryForge — Phase 8: 高级进阶与发布就绪计划

> 首席架构师签发 | 2026-05-26
> 前置条件：Phase 7 Closing Audit 全部 P0-P3 已完成并验证通过
> 目标：将 StoryForge 从"本地可验证原型"升级为"可部署、可观测、可协作的生产系统"

---

## 全局原则

1. **每个 Stage 独立可交付** — 完成一个 Stage 即可发布该层能力，不依赖后续 Stage。
2. **向后兼容** — 现有 `pnpm verify && pnpm e2e && pnpm test` 门禁在每个 Stage 完成后仍必须通过。
3. **证据链不断** — 所有变更必须在 `.codex/verification-report.md` 留下验证记录。
4. **渐进式复杂度** — Stage 1-2 为基础设施，Stage 3-4 为能力补全，Stage 5 为生产发布。

---

## Stage 1: 工程基础设施 — CI/CD 与代码质量门禁

> 预计工作量：2-3 天 | 优先级：P0
> 目标：建立自动化质量门禁，消除"只有本地能验证"的瓶颈

### 1-1. GitHub Actions CI Pipeline (P0)

**问题：** 当前所有验证仅在本地运行，无自动化 CI。团队协作中任何人推送代码都可能破坏契约而无人察觉。

**文件：** `.github/workflows/ci.yml`（新建）

- [x] **Step 1-1a: 创建基础 CI workflow**
  - 触发条件：`push` 到 `main`，以及所有 `pull_request`
  - Job 矩阵：
    ```yaml
    jobs:
      lint-and-typecheck:
        # Node 20 + pnpm install + tsc --noEmit + eslint
      test-web:
        # pnpm --filter @storyforge/web test
      test-shared:
        # pnpm --filter @storyforge/shared test
      test-api:
        # Python 3.11 + uv sync + pytest (不依赖外部服务，mock DB)
      test-workflow:
        # Python 3.11 + uv sync + pytest
      contract-check:
        # pnpm openapi + git diff --exit-code (契约漂移检测)
    ```
  - 验证：推送分支后 Actions 页面出现 6 个 Job 并全部通过。

- [x] **Step 1-1b: 创建 E2E integration workflow**
  - 使用 `services:` 声明 PostgreSQL + Redis 容器（CI 环境无 MinIO 可跳过对象存储）
  - 运行 `pnpm e2e`（需适配 CI 环境：无 PowerShell → 将 `generate-openapi.ps1` 改为跨平台 Node 脚本或 Bash 等价物）
  - 验证：E2E Job 在 CI 中通过。

- [x] **Step 1-1c: 将 generate-openapi 脚本改为跨平台**
  - 当前 `scripts/generate-openapi.ps1` 仅 Windows PowerShell 可用，CI 通常为 Linux。
  - 新建 `scripts/generate-openapi.mjs`（Node 脚本），功能等价：启动 FastAPI → 拉取 /openapi.json → 写入 contracts 目录。
  - 保留 `.ps1` 作为 Windows 快捷方式，内部调用 `node scripts/generate-openapi.mjs`。
  - 验证：`node scripts/generate-openapi.mjs` 在 bash 下可用。

### 1-2. ESLint + Prettier 代码风格门禁 (P1)

**问题：** 无自动化代码风格检查，团队协作时风格漂移不可避免。TypeScript `strict: true` 只保证类型安全，不保证代码质量。

**文件：** `eslint.config.mjs`（新建）、`.prettierrc.json`（新建）、`apps/web/.prettierrc.json`（新建）

- [x] **Step 1-2a: 配置 ESLint flat config + Prettier**
  - 根目录安装：`eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `prettier`
  - 配置 `eslint.config.mjs`，包含：
    - TypeScript 推荐规则（`@typescript-eslint/recommended`）
    - Prettier 兼容（`eslint-config-prettier`）
    - 忽略 `node_modules/`, `dist/`, `.next/`, `generated/`
  - 配置 `.prettierrc.json`：`{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100 }`
  - 验证：`pnpm exec eslint . && pnpm exec prettier --check .`

- [x] **Step 1-2b: 修复现有代码的 lint 告警**
  - 运行 `pnpm exec eslint . --fix && pnpm exec prettier --write .`
  - 对无法自动修复的问题逐一处理。
  - 验证：`pnpm exec eslint .` 零告警退出。

- [x] **Step 1-2c: Python 侧添加 ruff linter**
  - 在 `apps/api/pyproject.toml` 和 `apps/workflow/pyproject.toml` 添加 `[tool.ruff]` 配置段。
  - 规则集：`select = ["E", "F", "W", "I", "UP", "B", "SIM"]`
  - CI Job 增加 `ruff check .` 步骤。
  - 验证：`cd apps/api && uv run ruff check .`

### 1-3. Pre-commit Hooks (P2)

**文件：** `.pre-commit-config.yaml`（新建）

- [x] **Step 1-3: 配置 pre-commit hooks**
  - 包含：prettier（TS/JSON/MD）、eslint、ruff（Python）、检测大文件、检测 secrets。
  - 验证：`pre-commit run --all-files`

---

## Stage 2: 可观测性 — 日志、监控与告警

> 预计工作量：2-3 天 | 优先级：P0
> 目标：从"出了问题看终端"升级为"出了问题有据可查、有警可报"

### 2-1. 结构化日志 (P0)

**问题：** 当前 Python 侧使用 `logging.getLogger(__name__)` 输出纯文本日志，无统一格式。生产环境中无法被日志聚合系统（ELK/Loki/CloudWatch）解析。

**文件：** `apps/api/app/common/logging_config.py`（新建）、`apps/api/app/main.py`

- [x] **Step 2-1a: API 侧引入 structlog 结构化日志**
  - 安装 `structlog` 到 `apps/api/pyproject.toml`。
  - 创建 `logging_config.py`，配置 JSON 格式输出（生产）/ 彩色终端输出（开发）。
  - 每条日志自动附加：`timestamp`, `level`, `logger`, `request_id`。
  - 在 `main.py` 的 lifespan 中调用 `configure_logging()`。
  - 验证：启动 API 后日志输出为 JSON 格式（`STORYFORGE_ENV=production`）或彩色终端。

- [x] **Step 2-1b: 请求级 Request ID 注入**
  - 新增 ASGI 中间件，为每个请求生成 UUID request_id。
  - 将 request_id 注入 structlog context，贯穿请求生命周期所有日志。
  - 响应头返回 `X-Request-Id`，便于前端排障。
  - 验证：`curl -i http://localhost:8000/health` 响应头包含 `X-Request-Id`。

- [x] **Step 2-1c: Workflow 侧结构化日志**
  - `apps/workflow` 同样配置 structlog，格式与 API 一致。
  - 每个 LangGraph 节点执行添加 `node_name`, `workflow_id`, `duration_ms` 字段。
  - 验证：`cd apps/workflow && uv run pytest tests/ -q`（日志格式不破坏测试）。

### 2-2. Sentry 错误追踪集成 (P0)

**问题：** `sentry-sdk` 已在 `pyproject.toml` 依赖中，但未初始化。生产环境中异常只打日志不告警。

**文件：** `apps/api/app/main.py`、`apps/api/app/common/sentry_config.py`（新建）

- [x] **Step 2-2a: API 侧 Sentry 初始化**
  - 创建 `sentry_config.py`：
    ```python
    def init_sentry():
        dsn = os.getenv("SENTRY_DSN")
        if not dsn:
            return
        sentry_sdk.init(
            dsn=dsn,
            environment=os.getenv("STORYFORGE_ENV", "development"),
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        )
    ```
  - 在 `main.py` lifespan 中调用。
  - `.env.example` 添加 `SENTRY_DSN=` 和 `SENTRY_TRACES_SAMPLE_RATE=0.1`。
  - 验证：无 `SENTRY_DSN` 时启动不报错；有 DSN 时 Sentry 后台收到 test event。

- [x] **Step 2-2b: 前端 Sentry 集成**
  - `apps/web` 安装 `@sentry/nextjs`。
  - 配置 `sentry.client.config.ts` 和 `sentry.server.config.ts`。
  - 更新 `app/error.tsx` 在 error boundary 中调用 `Sentry.captureException(error)`。
  - 验证：`cd apps/web && pnpm build`（Sentry 注入不破坏构建）。

### 2-3. 健康检查与就绪探针 (P1)

**文件：** `apps/api/app/domains/health/router.py`（增强）

- [x] **Step 2-3: 增强 /health 端点为 /health/live + /health/ready**
  - `/health/live`：仅返回 200（进程存活）。
  - `/health/ready`：检查 DB 连接池可用 + Redis 可达 + 关键表存在。
  - 返回结构化 JSON：`{ "status": "ready", "checks": { "db": "ok", "redis": "ok" } }`。
  - 验证：`curl http://localhost:8000/health/ready`

### 2-4. 关键业务指标采集 (P2)

**文件：** `apps/api/app/common/metrics.py`（新建）

- [x] **Step 2-4: 添加 Prometheus 格式指标端点**
  - 安装 `prometheus-fastapi-instrumentator`。
  - 自动采集：请求延迟、状态码分布、活跃连接数。
  - 自定义计数器：`judge_calls_total`, `repair_patches_total`, `batch_refinery_jobs_total`。
  - 暴露 `/metrics` 端点。
  - 验证：`curl http://localhost:8000/metrics` 返回 Prometheus 格式数据。

---

## Stage 3: 安全加固与认证升级

> 预计工作量：2-3 天 | 优先级：P1
> 目标：从"单一 API Key"升级为"可上生产的安全姿态"

### 3-1. 安全响应头 (P0)

**文件：** `apps/api/app/main.py`、`apps/web/next.config.ts`（新建或增强）

- [x] **Step 3-1a: API 侧添加安全响应头中间件**
  - 新增 ASGI 中间件，为所有响应添加：
    ```
    X-Content-Type-Options: nosniff
    X-Frame-Options: DENY
    X-XSS-Protection: 0
    Referrer-Policy: strict-origin-when-cross-origin
    Permissions-Policy: camera=(), microphone=(), geolocation=()
    ```
  - 验证：`curl -I http://localhost:8000/health` 包含上述头。

- [x] **Step 3-1b: Web 侧配置 CSP 和安全头**
  - 创建或增强 `next.config.ts`，添加 `headers()` 配置：
    ```typescript
    Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${API_URL}
    ```
  - 验证：浏览器控制台无 CSP 违规告警。

### 3-2. Per-API-Key 速率限制 (P1)

**问题：** 当前 slowapi 限制为全局 60/min，所有客户端共享配额。单个恶意客户端可耗尽全局配额。

**文件：** `apps/api/app/main.py`

- [x] **Step 3-2: 速率限制从全局改为 per-API-Key**
  - slowapi key_func 改为从 `X-StoryForge-API-Key` 提取，而非 IP。
  - 不同路由组设置不同限额：
    - 读取类（GET）：120/min
    - 写入类（POST/PATCH/DELETE）：60/min
    - 批量类（batch_refinery）：10/min
  - 验证：`cd apps/api && python -m pytest tests/test_api_middleware.py -q`

### 3-3. 输入验证与防注入加固 (P1)

**文件：** 各 domain 的 `schema.py`

- [x] **Step 3-3a: Pydantic 模型添加字符串长度和格式约束**
  - 所有用户可控字符串字段添加 `max_length` 约束（如 `title: str = Field(max_length=500)`）。
  - 所有 ID 字段添加格式约束（UUID 格式或正整数）。
  - 验证：提交超长字符串返回 422 而非 500。

- [x] **Step 3-3b: SQL 注入防护审计**
  - 搜索所有 `text()` 和 f-string SQL 拼接，确保全部使用参数化查询。
  - 验证：`cd apps/api && grep -rn "text(" app/domains/ | grep -v ".pyc"` — 仅合法用法。

### 3-4. JWT 认证方案（可选 — 多用户场景） (P2)

**文件：** `apps/api/app/common/auth.py`（新建）

- [x] **Step 3-4: 设计并实现 JWT Bearer Token 认证**
  - 保留当前 API Key 认证作为 service-to-service 通道。
  - 新增 JWT Bearer Token 路径用于前端用户认证。
  - 中间件按 Header 类型自动选择认证方式：
    - `X-StoryForge-API-Key` → 静态 Key 验证
    - `Authorization: Bearer <token>` → JWT 验证
  - JWT Payload 包含 `user_id`, `role`, `exp`。
  - 验证：单元测试覆盖 Token 签发、验证、过期、角色判断。

---

## Stage 4: 前端能力补全与用户体验

> 预计工作量：3-5 天 | 优先级：P1
> 目标：从"诊断控制台"升级为"可交互的创作工作台"

### 4-1. Studio 完整交互流 (P0)

**问题：** 当前 Studio 页面是"读取 + 表单提交"的最小闭环，缺少完整的创作工作流交互。

**文件：** `apps/web/app/studio/` 下各组件

- [x] **Step 4-1a: Studio 多步骤创作向导**
  - 实现分步流程：选择作品 → 选择章节 → 场景编辑 → 预览 Scene Packet → 提交生成 → Judge 审查 → Repair → 批准
  - 每步有明确的状态指示和导航。
  - 验证：浏览器中完整走通一次创作流程。

- [x] **Step 4-1b: 实时生成状态轮询**
  - 提交生成任务后，前端轮询 `/api/v1/jobs/{job_run_id}` 展示进度。
  - 使用 `useEffect` + `setInterval`（或 Server-Sent Events）实现状态更新。
  - 验证：提交任务后页面实时显示 `queued → running → completed/failed`。

### 4-2. Diff Viewer 与审查面板增强 (P1)

**文件：** `apps/web/components/diff-viewer.tsx`、`apps/web/components/judge-panel.tsx`

- [x] **Step 4-2a: Diff Viewer 支持行级对比**
  - 当前 diff-viewer 为简单文本对比，改为行级高亮差异（绿色新增/红色删除）。
  - 使用 `diff` 库或自实现 Myers diff 算法。
  - 验证：浏览器中查看修复前后对比有清晰的行级高亮。

- [x] **Step 4-2b: Judge Panel 支持逐条审查与批量操作**
  - Judge 审查结果列表支持：逐条展开详情、批量接受/拒绝、添加批注。
  - 验证：浏览器中完整审查流程可用。

### 4-3. 全局 UI 体验优化 (P2)

- [x] **Step 4-3a: 添加全局导航侧栏**
  - 替代当前首页卡片列表，添加固定侧栏导航。
  - 包含：Studio、检索工作台、任务中心、工件库、评测、世界观、设置。
  - 响应式设计：移动端折叠为 hamburger 菜单。
  - 验证：浏览器中导航正常，移动端断点响应正确。

- [x] **Step 4-3b: 加载状态与错误状态统一组件**
  - 创建 `components/ui/loading-skeleton.tsx` 和 `components/ui/error-card.tsx`。
  - 所有页面统一使用，替代当前各页面的 ad-hoc 加载/错误显示。
  - 验证：网络慢速模拟下看到骨架屏，API 故障时看到统一错误卡片。

- [x] **Step 4-3c: 暗色模式支持**
  - 基于 Tailwind CSS `dark:` 变体实现暗色主题。
  - 使用 `next-themes` 管理主题切换。
  - 验证：切换暗色模式后所有页面样式正确。

### 4-4. 前端测试覆盖率提升 (P2)

- [x] **Step 4-4: 补齐核心页面组件测试**
  - 为 `/retrieval`, `/artifacts`, `/evaluations`, `/worldbuilding` 页面各添加至少 1 个组件测试。
  - 为 `diff-viewer`, `judge-panel`, `scene-packet` 组件添加单元测试。
  - 目标：Web 测试数从 7 提升到 20+。
  - 验证：`cd apps/web && pnpm test`

---

## Stage 5: 容器化部署与生产发布

> 预计工作量：3-4 天 | 优先级：P0（发布必需）
> 目标：从"本地 dev 环境"升级为"一键部署到任何环境"

### 5-1. 应用容器化 (P0)

**文件：** `apps/api/Dockerfile`、`apps/web/Dockerfile`、`apps/workflow/Dockerfile`（均为新建）

- [x] **Step 5-1a: API Dockerfile**
  - 基于 `python:3.11-slim`，多阶段构建。
  - 使用 `uv` 安装依赖（利用缓存层）。
  - 入口：`uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WORKERS:-2}`
  - 非 root 用户运行。
  - 验证：`docker build -t storyforge-api apps/api && docker run --rm storyforge-api python -c "from app.main import app; print('ok')"`

- [x] **Step 5-1b: Web Dockerfile**
  - 基于 `node:20-alpine`，多阶段构建。
  - Stage 1: pnpm install + next build
  - Stage 2: 仅复制 `.next/standalone` + `public/` + `.next/static`
  - 入口：`node server.js`
  - 验证：`docker build -t storyforge-web apps/web`

- [x] **Step 5-1c: Workflow Dockerfile**
  - 基于 `python:3.11-slim`，类似 API。
  - 入口：可配置的 runner 启动脚本。
  - 验证：`docker build -t storyforge-workflow apps/workflow`

### 5-2. 完整 Docker Compose 编排 (P0)

**文件：** `docker-compose.yml`（增强）、`docker-compose.prod.yml`（新建）

- [x] **Step 5-2a: docker-compose.yml 增加应用服务**
  - 在现有 postgres/redis/minio 基础上，添加 api、web、workflow 三个服务。
  - 配置 `depends_on` 条件（`service_healthy`）确保启动顺序。
  - 验证：`docker compose up -d && docker compose ps`（所有 6 个容器 healthy）。

- [x] **Step 5-2b: docker-compose.prod.yml 生产覆盖**
  - 生产配置覆盖：资源限制（memory/cpu）、restart: always、日志驱动（json-file + 大小限制）。
  - 不挂载源码卷、不暴露数据库端口到宿主机。
  - 环境变量通过 `env_file` 或 secrets 注入。
  - 验证：`docker compose -f docker-compose.yml -f docker-compose.prod.yml config`

### 5-3. 数据库迁移自动化 (P1)

**文件：** `scripts/migrate.sh`（新建）

- [x] **Step 5-3: 容器启动时自动执行 Alembic 迁移**
  - API 容器 entrypoint 脚本：先执行 `alembic upgrade head`，再启动 uvicorn。
  - 添加迁移锁（advisory lock）防止多实例并发迁移。
  - 回滚命令文档化：`alembic downgrade -1`。
  - 验证：全新数据库 + `docker compose up api` → 自动迁移到 head。

### 5-4. 多环境配置管理 (P1)

**文件：** `.env.example`（增强）、`.env.production.example`（新建）、`apps/api/app/common/config.py`（新建）

- [x] **Step 5-4: 实现基于 Pydantic Settings 的配置管理**
  - 创建 `config.py`，使用 `pydantic-settings` 的 `BaseSettings` 类。
  - 所有配置项集中声明，带类型、默认值和文档字符串。
  - 支持 `.env` 文件加载和环境变量覆盖。
  - 启动时校验所有必需配置项存在。
  - 验证：缺少必需配置项时启动报明确错误。

### 5-5. Nginx 反向代理配置 (P2)

**文件：** `deploy/nginx/default.conf`（新建）

- [x] **Step 5-5: 添加 Nginx 反向代理配置**
  - 路由规则：`/api/*` → API 容器，`/*` → Web 容器。
  - 配置：gzip 压缩、静态资源缓存头、连接超时、请求体大小限制。
  - 添加到 docker-compose.yml 作为入口服务。
  - 验证：通过 `http://localhost` 访问前端，`http://localhost/api/v1/health` 访问 API。

---

## Stage 6: RAG 能力补全与真实 AI 接入

> 预计工作量：3-5 天 | 优先级：P1
> 目标：从"确定性 mock 生成"升级为"真实 AI 驱动的创作管线"

### 6-1. Embedding Provider 真实接入 (P0)

**问题：** 当前 `STORYFORGE_EMBEDDING_PROVIDER=local` 使用 fake embedding，RAG 检索没有语义能力。

**文件：** `apps/api/app/domains/retrieval/embedding_provider.py`（新建或增强）

- [x] **Step 6-1: 实现可配置的 Embedding Provider**
  - 支持多种 provider：`openai`（text-embedding-3-small）、`local`（sentence-transformers）、`fake`（测试用）。
  - 通过 `STORYFORGE_EMBEDDING_PROVIDER` 环境变量切换。
  - 接口统一：`async def embed(texts: list[str]) -> list[list[float]]`
  - 批量处理 + 自动分片（API 限制单次 2048 tokens）。
  - 验证：配置 OpenAI Key 后，embedding 端点返回真实向量。

### 6-2. Reranker 服务接入 (P2)

**文件：** `apps/api/app/domains/retrieval/reranker.py`（新建或增强）

- [x] **Step 6-2: 实现可配置的 Reranker**
  - 支持：`cohere`、`cross-encoder`（本地模型）、`disabled`。
  - 检索流程：向量召回 top-50 → Reranker 精排 top-10 → 返回。
  - 验证：Reranker 开启后，检索结果相关性提升（通过 Judge 评分对比）。

### 6-3. LLM Provider 生产化 (P1)

**文件：** `apps/workflow/storyforge_workflow/runtime/provider_adapter.py`

- [x] **Step 6-3a: Provider 故障自动降级**
  - 主 Provider 不可用时自动切换到备用 Provider。
  - 配置：`STORYFORGE_LLM_FALLBACK_PROVIDER`、`STORYFORGE_LLM_FALLBACK_MODEL`。
  - 降级事件记录到日志和 Sentry。
  - 验证：模拟主 Provider 超时，任务自动在备用 Provider 完成。

- [x] **Step 6-3b: Token 用量追踪**
  - 每次 LLM 调用记录 `prompt_tokens`, `completion_tokens`, `total_tokens`, `model`, `cost_estimate`。
  - 写入 `model_runs` 表。
  - 验证：`SELECT SUM(total_tokens) FROM model_runs WHERE created_at > NOW() - INTERVAL '1 day'` 返回非零值。

---

## Stage 7: 性能优化与规模化

> 预计工作量：2-3 天 | 优先级：P2
> 目标：确保系统在生产负载下稳定运行

### 7-1. API 分页与排序标准化 (P0)

**问题：** 当前列表接口无分页，大数据量下响应会超时或 OOM。

- [x] **Step 7-1: 所有列表接口添加游标分页**
  - 统一分页参数：`?cursor=<last_id>&limit=20`（基于主键游标，非 offset）。
  - 响应统一格式：`{ "items": [...], "next_cursor": "...", "has_more": true }`。
  - 验证：`curl "http://localhost:8000/api/v1/artifacts?limit=2"` 返回分页结构。

### 7-2. Redis 缓存策略 (P1)

**问题：** `common/redis_cache.py` 存在但使用范围有限。高频读取接口（资产列表、世界观数据）无缓存。

- [x] **Step 7-2: 为高频读取接口添加 Redis 缓存**
  - 缓存目标：资产列表（TTL 60s）、世界观数据（TTL 300s）、Scene Packet 编译结果（TTL 120s）。
  - 写入时自动失效（cache invalidation on write）。
  - 验证：连续两次 GET 请求，第二次响应时间 < 10ms。

### 7-3. 前端性能优化 (P2)

- [x] **Step 7-3a: 路由级代码分割**
  - 使用 `next/dynamic` 对重组件（diff-viewer、judge-panel）进行懒加载。
  - 验证：`next build` 输出中各路由 bundle 大小合理（< 200KB per route）。

- [x] **Step 7-3b: 图片与静态资源优化**
  - 配置 `next/image` 用于所有图片。
  - 静态资源添加 immutable 缓存头。
  - 验证：Lighthouse Performance 分数 > 90。

---

## Stage 8: 文档与开发者体验

> 预计工作量：1-2 天 | 优先级：P2
> 目标：新成员入手时间从"半天"降到"30分钟"

### 8-1. API 文档增强 (P1)

- [x] **Step 8-1: 增强 OpenAPI 文档的描述和示例**
  - 为所有端点添加中文描述（`summary` 和 `description`）。
  - 为请求/响应 Schema 添加 `example` 字段。
  - 验证：访问 `/docs` 每个端点有清晰描述和可运行示例。

### 8-2. 本地开发一键启动 (P1)

**文件：** `scripts/dev-start.mjs`（新建）

- [x] **Step 8-2: 创建一键开发环境启动脚本**
  - 一条命令完成：检查依赖 → 启动 Docker 服务 → 等待 healthy → 执行迁移 → 启动 API + Web dev server。
  - 支持参数：`--api-only`, `--web-only`, `--skip-docker`。
  - 验证：`node scripts/dev-start.mjs` 后浏览器访问 `http://localhost:3000` 正常。

### 8-3. CLAUDE.md 项目上下文文件 (P2)

- [x] **Step 8-3: 创建或更新 CLAUDE.md**
  - 包含：项目结构概览、技术栈、常用命令、架构决策、协作约定。
  - 验证：新会话中 Claude Code 能直接理解项目上下文。

---

## 执行优先级总表

| 优先级   | Stage   | 内容                             | 预估 | 关键产出                |
| -------- | ------- | -------------------------------- | ---- | ----------------------- |
| **P0-A** | Stage 1 | CI/CD + 代码质量门禁             | 2-3d | GitHub Actions 自动验证 |
| **P0-B** | Stage 2 | 可观测性（日志 + Sentry + 指标） | 2-3d | 结构化日志 + 错误告警   |
| **P0-C** | Stage 5 | 容器化部署                       | 3-4d | 一键 docker compose up  |
| **P1-A** | Stage 3 | 安全加固                         | 2-3d | 安全响应头 + 输入验证   |
| **P1-B** | Stage 4 | 前端能力补全                     | 3-5d | 完整创作工作台          |
| **P1-C** | Stage 6 | RAG 真实接入                     | 3-5d | 真实语义检索 + AI 生成  |
| **P2-A** | Stage 7 | 性能优化                         | 2-3d | 分页 + 缓存 + 前端优化  |
| **P2-B** | Stage 8 | 文档与 DX                        | 1-2d | 一键启动 + API 文档     |

**总预估：20-28 工作日**

---

## 验证门禁（每个 Stage 完成后）

```bash
# 基础门禁（每个 Stage 必须通过）
pnpm verify && pnpm test && pnpm e2e

# Stage 1 额外：CI 流水线自身通过
gh run list --limit 1 --json conclusion

# Stage 2 额外：日志和监控可验证
curl -s http://localhost:8000/health/ready | jq .
curl -s http://localhost:8000/metrics | head -5

# Stage 5 额外：全容器化启动
docker compose up -d && docker compose ps
curl -s http://localhost/api/v1/health/ready
```

---

## 风险与缓解

| 风险                                  | 影响               | 缓解措施                        |
| ------------------------------------- | ------------------ | ------------------------------- |
| CI 环境与本地差异（Windows vs Linux） | 测试通过本地失败CI | Step 1-1c 跨平台脚本改造        |
| Sentry 高频告警疲劳                   | 忽略真正问题       | 配置告警规则和聚合策略          |
| JWT 认证增加复杂度                    | 调试困难           | 保留 API Key 作为开发通道       |
| Docker 多阶段构建缓存失效             | 构建慢             | 合理分层 + BuildKit 缓存        |
| 真实 LLM 接入后成本不可控             | 测试消耗 Token     | 开发环境保留 deterministic 模式 |
| 前端重构影响已验证页面                | 回归               | Stage 4-4 先补测试再重构        |

---

# StoryForge — Phase 9: 先产出第一本书的全书编排计划

> 首席架构师签发 | 2026-05-27
> 前置条件：Phase 8 Stage 1/2/5/6 已收口（CI、可观测性、容器化、真实 LLM/Embedding 接入能力）
> 核心目标：先让 StoryForge 产出一本可审计的短篇小说，再逐层补强恢复、成本、长程一致性与出版级导出。
> 总预估：18-28 工作日，按 9A/9B/9C 三段推进；任一段未通过验收，不进入下一段。

> 事实源边界：本计划是历史阶段计划和 Definition of Done 记录，当前阶段事实以 `docs/internal/current-phase.md` 为准；不能把本计划中的历史验收文字单独作为最新状态来源。

---

## 9.0 执行裁决

原 Phase 9 蓝图方向正确，但一次性覆盖 Blueprint、BookLoop、Character Bible、Timeline、Style Guard、EPUB、审计 UI 和长任务韧性，P0 过多，容易在质量系统里停太久，迟迟无法回答“能不能产出一本小说”。

本修订版改成三段式：

1. **Phase 9A：第一本最小可生成书**
   - 目标：跑通 `一句话立意 -> 章节计划 -> 逐章生成 -> Judge/Repair -> 自动批准 -> Markdown 导出 -> audit_report`。
   - 验收：3 章、3000-6000 字、mock/deterministic provider 下自动跑完，产出 `book.md` 与 `audit_report.json`。

2. **Phase 9B：可恢复、可控成本、可长时间运行**
   - 目标：BookRun 可 pause/resume/retry，预算超限会硬暂停，真实 LLM 冒烟不失控。
   - 验收：3 章 BookRun 可从断点续跑；token/time/chapter 预算触顶会 pause；远程 LLM 小样本冒烟通过。

3. **Phase 9C：长程质量与出版增强**
   - 目标：补齐 Story Memory 自动注入、Character Bible、Timeline、漂移评分、Style Guard、EPUB 与审计 UI。
   - 验收：3-5 万字短篇真实跑完，人工通读无明显人物/世界观矛盾。

在 9A 完成前，禁止把任务扩散到 EPUB、复杂图表、Style Guard 或完整审计 UI。Phase 9 的第一原则是：**先产出第一本可审计短篇，再让它变强。**

---

## 全局原则

1. **垂直薄片优先。** 每个阶段都必须交付一条能运行的端到端路径，而不是只完成底层组件。
2. **复用现有事实源。** API 继续是业务真相源；Workflow 负责长任务编排；Web 只做入口、状态和人工介入；共享契约继续走 OpenAPI。
3. **先 deterministic，后真实 LLM。** 9A 必须用 deterministic/mock provider 稳定复现；9B 再接真实 LLM 冒烟。
4. **自动化不跳过证据。** generate/judge/repair/approve/export 都必须能追溯到 `job_runs`、`model_runs`、`artifacts` 或 `evaluations`。
5. **人审插桩保留。** 自动批准只允许在 Judge 通过时执行；失败、预算超限、连续降级和漂移异常必须 pause。
6. **不引入新微服务。** Phase 9 仍落在 `apps/api`、`apps/workflow`、`apps/web` 与 `packages/shared` 内。

---

## Phase 9A：第一本最小可生成书

> 预计工作量：6-9 工作日 | 优先级：P0
> 目标：跑通一本 3 章短篇的自动生成、审查、修复、批准和 Markdown 导出。

### 9A-1. Book Blueprint 最小闭环

**问题：** 现有 `books` 更像章节容器，没有承载整本书的 premise、目标字数、章节数、语气和结构约束。

**文件：** `apps/api/app/domains/blueprints/`、`apps/api/alembic/versions/*book_blueprints*.py`、`apps/web/app/blueprints/`

- [x] **Step 9A-1a：新增 `book_blueprints` 最小表**
  - 字段：`id`、`book_id`、`premise`、`tone`、`target_word_count`、`target_chapter_count`、`chapter_word_count_min`、`chapter_word_count_max`、`status(draft/locked)`、`version`、`metadata(jsonb)`。
  - 不在 9A 引入 Character Bible、Timeline 或复杂 act graph，只保留 `metadata` 扩展口。
  - 验证：`uv run alembic upgrade head` 干净库通过；`tests/test_blueprint_api.py` 覆盖创建、读取、锁定。

- [x] **Step 9A-1b：Blueprint API + 锁定语义**
  - `POST /api/blueprints`、`GET /api/blueprints/{id}`、`POST /api/blueprints/{id}/lock`。
  - 只有 `locked` blueprint 可以进入章节规划器。
  - 验证：未锁定 blueprint 触发规划返回 422；锁定后可触发。

- [x] **Step 9A-1c：Blueprint Web 最小入口**
  - 新增 `/blueprints` 列表和详情页，支持创建、查看、锁定、触发章节计划。
  - 不做复杂 JSON 可视化；只展示 premise、tone、章节数、目标字数和状态。
  - 验证：浏览器走通“创建 blueprint -> 锁定 -> 触发章节计划”。

### 9A-2. Chapter Planner 最小章节计划

**文件：** `apps/workflow/storyforge_workflow/planners/chapter_planner.py`、既有章节目标 domain

- [x] **Step 9A-2a：章节规划器 deterministic 节点**
  - 输入：locked blueprint。
  - 输出：`chapter_index`、`title`、`goal`、`pov`、`location`、`required_beats`、`expected_word_count`。
  - 9A 允许 deterministic/provider 双模式：测试固定输出，真实模式通过 provider 生成。
  - 验证：`apps/workflow/tests/test_chapter_planner.py` 覆盖相同输入可稳定产出 3 章计划。

- [x] **Step 9A-2b：章节计划写回既有章节目标**
  - 优先复用现有 `chapter_goals` 或章节目标表，不新建平行模型。
  - 写入 `source=blueprint_planner`、`blueprint_id`、`chapter_index`。
  - 验证：Studio 章节列表能读到 planner 写入的目标。

### 9A-3. 单章 NovelLoop v1

**文件：** `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`

- [x] **Step 9A-3a：单章 LoopGraph**
  - 节点链：`compile_context -> generate_scene -> judge -> repair_if_needed -> approve_if_passed`。
  - `judge=pass` 才允许调用现有 `POST /api/studio/approve`。
  - `judge=fail` 且 repair 次数耗尽时写入 `awaiting_review`，不落低质内容。
  - 验证：`apps/workflow/tests/test_novel_loop_single_chapter.py` 覆盖 pass、repair 后 pass、repair 耗尽 pause 三条分支。

- [x] **Step 9A-3b：生成正文写回证据链**
  - 每次生成必须记录 `model_run`，approve 后必须能追溯 scene/chapter 写回来源。
  - 不要求 9A 完成复杂记忆抽取，只记录最小 `source_model_run_id` 和 `judge_report_id`。
  - 验证：API 测试确认批准章节可追溯到 model_run 与 judge 结果。

### 9A-4. BookLoop v1：三章短篇自动跑完

**文件：** `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`、`apps/api/app/domains/book_runs/`

- [x] **Step 9A-4a：新增 `book_runs` 最小表与 API**
  - 字段：`id`、`book_id`、`blueprint_id`、`status(running/completed/awaiting_review/failed)`、`current_chapter_index`、`total_chapters`、`progress(jsonb)`。
  - API：`POST /api/book-runs`、`GET /api/book-runs/{id}`。
  - 验证：`apps/api/tests/test_book_runs.py` 覆盖启动和读取。

- [x] **Step 9A-4b：BookLoop 顺序驱动 3 章 NovelLoop**
  - 从 planner 写入的章节目标按 `chapter_index` 顺序执行。
  - 任一章 `awaiting_review` 则 BookRun 停在 `awaiting_review`，后续章节不继续。
  - 验证：`apps/workflow/tests/test_book_loop_three_chapters.py` 用 deterministic provider 跑完 3 章。

- [x] **Step 9A-4c：BookRun Web 最小状态页**
  - 新增 `/book-runs` 列表和详情页，展示状态、当前章、总章数、最近事件。
  - 控制按钮只保留“启动”和“查看”，pause/resume 放到 9B。
  - 验证：浏览器能启动 3 章 BookRun 并看到 completed。

### 9A-5. 最小全书导出

**文件：** `apps/api/app/domains/artifacts/exporters/book_markdown_exporter.py`

- [x] **Step 9A-5a：导出 `book.md`**
  - 输入：`BookRun.id`。
  - 输出：Markdown frontmatter + 章节目录 + 已批准章节正文。
  - 写入 `artifacts` 表，沿用现有 `payload_preview` 摘要机制。
  - 验证：3 章 BookRun completed 后能下载/读取 `book.md` 摘要。

- [x] **Step 9A-5b：导出 `audit_report.json`**
  - 包含：`book_run_id`、`blueprint_id`、章节列表、每章关联 `model_run_id`、`judge_report_id`、`repair_patch_id`、`approved_scene_id`。
  - 9A 不做审计 UI，只保证 JSON 可读可追溯。
  - 验证：`apps/api/tests/test_book_exporter.py` 覆盖每章都有证据索引。

### 9A Definition of Done

9A 完成必须同时满足：

1. `pnpm verify && pnpm test && pnpm e2e` 本地通过。
2. CI 与 E2E 远端 Actions 在 `master` push 上通过。
3. deterministic/mock provider 下启动一个 3 章 BookRun，状态到 `completed`。
4. 产出 `book.md`，总字数 3000-6000 字。
5. 产出 `audit_report.json`，每章至少能追溯到 model_run、judge 和 approve 写回。
6. `.codex/verification-report.md` 记录 9A 冒烟证据。

---

## Phase 9B：恢复、预算与真实 LLM 小样本

> 预计工作量：5-8 工作日 | 优先级：P0/P1
> 目标：让 BookRun 可控、可恢复、可在真实模型下小规模运行。

### 9B-1. BookRun Pause / Resume

- [x] **Step 9B-1a：BookRun checkpoint 语义**
  - 每章完成后记录 checkpoint，checkpoint 只保存引用 id，不塞完整正文。
  - 验证：3 章 BookRun checkpoint 数量等于完成章节数，单条体积小于 5MB。

- [x] **Step 9B-1b：`POST /api/book-runs/{id}/resume`**
  - 从最近 checkpoint 继续执行，已批准章节不得重复 approve。
  - 验证：执行到第 2 章前中断，再 resume 后从断点继续。

### 9B-2. 预算硬上限

- [x] **Step 9B-2a：Token / 时间 / 章节三重预算**
  - `book_runs` 增加 `token_budget`、`tokens_used`、`time_budget_sec`、`chapter_budget`。
  - 任一预算触顶，BookRun 进入 `paused_by_budget`。
  - 验证：`token_budget=100` 时自动 pause，且不会继续生成下一章。

- [x] **Step 9B-2b：BookRun 成本摘要**
  - 复用 Phase 8 Stage 6 token 用量追踪，BookRun 详情页展示累计 token、估算成本、剩余预算。
  - 验证：浏览器能看到 3 章 BookRun 的成本摘要。

### 9B-3. Provider 降级穿透

- [x] **Step 9B-3a：连续降级自动 pause**
  - 沿用 Stage 6 fallback provider；BookLoop 统计连续 fallback 次数。
  - 连续 N 次 fallback 后 BookRun pause，避免整本书静默跑在备用模型上。
  - 验证：构造主 provider 超时，fallback 3 次后 `status=paused_by_provider_degradation`。

### 9B-4. 真实 LLM 小样本冒烟

- [x] **Step 9B-4a：真实 LLM 1 章冒烟**
  - 使用私有 `.env` 配置真实 `STORYFORGE_LLM_API_KEY`，不提交密钥。
  - 只跑 1 章，预算上限必须开启。
  - 验证：章节生成、Judge、Repair/Approve、model_run token 记录均成功。
  - 证据：`.codex/real-llm-1ch-20260603-142925`；BookRun completed，实际 1 章，tokens_used=3047，`markdown_artifact_id=1`，`audit_artifact_id=2`，quality_score=100，quality_issue_count=0，人工通读已完成。该证据只覆盖 1 章 smoke，不能据此声明 10 章或 3-5 万字长程完成。

- [x] **Step 9B-4b：真实 LLM 3 章短篇冒烟**
  - 在 1 章通过后再跑 3 章。
  - 验收：BookRun completed，成本不超过预算，导出 `book.md` 可读。
  - 验证报告写入 `.codex/verification-report.md`。
  - 证据：`.codex/real-llm-3ch-20260603-173932`；BookRun completed，实际 3 章，tokens_used=14158，`book.md` 与 `audit_report.json` 已落盘，`quality_summary.status=ok`，人工通读已完成。该证据允许评估 10 章真实短篇 smoke；不能据此声明 10 章或 3-5 万字长程完成。

- [x] **Step 9B-4c：真实 LLM 10 章 smoke 最终验收**
  - 在 3 章 smoke 通过后，执行真实 10 章短篇 smoke，并保留预算上限、脱敏摘要、导出制品和人工通读记录。
  - 证据：`.codex/real-llm-10ch-20260604-110831`；BookRun completed，实际 10 章，tokens_used=145668，`book.md` 与 `audit_report.json` 已落盘，`quality_summary.status=ok`，人工通读已完成。
  - 最终门禁：`gate: pass_for_real_10ch_final_acceptance`。该证据只覆盖真实 10 章 smoke，不能据此声明真实 3-5 万字长程完成。

---

## Phase 9C：长程质量、EPUB 与审计增强

> 预计工作量：7-11 工作日 | 优先级：P1/P2
> 目标：把“能产出”提升为“更稳定、更一致、更接近出版工作流”。

### 9C-1. Story Memory 自动注入与抽取

- [x] **Step 9C-1a：Scene Packet 自动召回 memory**
  - 根据 POV、location、前一章、出场人物召回相关 `story_memory`。
  - 注入 `memory_context` 字段。
  - 验证：`tests/test_context_compiler_memory_injection.py` 覆盖人物、地点、前章尾状态。

- [x] **Step 9C-1b：章节结束抽取 memory**
  - NovelLoop approve 后抽取人物状态、世界观锚点和时间推进。
  - 写入 `story_memory`，带 `source_chapter_id` 和 `confidence`。
  - 验证：跑完一章后新增至少 1 条章节来源 memory。

### 9C-2. Character Bible 与 Timeline Guard

- [x] **Step 9C-2a：Character Bible 最小表与硬规则**
  - 字段：`book_id`、`character_id`、`canonical_name`、`aliases(jsonb)`、`voice_traits(jsonb)`、`forbidden_traits(jsonb)`。
  - 验证：CRUD API + Alembic 迁移通过。

- [x] **Step 9C-2b：Judge 增加一致性维度**
  - 新增 `character_consistency`、`world_consistency`。
  - 违反 `forbidden_traits` 必须 fail，并输出可供 Repair 使用的 violation。
  - 验证：构造违反 forbidden_traits 的章节，Judge fail，Repair 后 pass。

- [x] **Step 9C-2c：Timeline 简单矛盾检测**
  - 最小规则：已死亡角色不能出场；同一角色同一时间不能在两地。
  - 验证：构造矛盾章节，Judge fail。

### 9C-3. 风格与节奏增强

- [x] **Step 9C-3a：章节节奏标签**
  - Blueprint metadata 支持 `pacing_tag`：`setup/rising/climax/falling/resolution`。
  - Scene Packet 注入 `pacing_directive`。
  - 验证：climax 章节生成包包含对应 pacing_directive。

- [x] **Step 9C-3b：Style Guard**
  - 从已批准章节建立文风指纹，后续章节偏离时 Judge 文风维度扣分。
  - 验证：故意切换文风后分数下降。

### 9C-4. EPUB 与审计 UI

- [x] **Step 9C-4a：EPUB 导出**
  - 在 9A Markdown 导出稳定后再引入 `ebooklib`。
  - 生成 `book.epub` 并写入 artifacts。
  - 验证：EPUB 文件可被本地阅读器或结构检查脚本打开。

- [x] **Step 9C-4b：全书审计页**
  - 新增 `/book-runs/[id]/audit`，按章节展示 generate/judge/repair/approve/memory_extract 事件。
  - 点击事件跳转到对应 model_run、artifact 或 evaluation 摘要。
  - 验证：完成的 BookRun 可以在审计页回看完整证据链。

### 9C Definition of Done

9C 完成必须同时满足：

1. 真实 LLM 跑完 3-5 万字短篇。
2. `book.md`、`book.epub`、`audit_report.json` 均生成并登记到 artifacts。
3. 人工通读记录写入 `.codex/verification-report.md`，无明显人物、世界观或时间线矛盾。
4. `docs/internal/current-phase.md` 删除“完整交互式 Studio 编排器完全不存在”的表述，改为记录已完成边界和剩余增强。

---

## Phase 9 执行优先级总表

| 顺序 | 阶段 | 内容                        | 预估  | 关键产出                                 | 是否阻塞宣称“能产出一本小说” |
| ---- | ---- | --------------------------- | ----- | ---------------------------------------- | ---------------------------- |
| 1    | 9A   | 最小全书闭环                | 6-9d  | 3 章 `book.md` + `audit_report.json`     | 是                           |
| 2    | 9B   | 恢复、预算、真实 LLM 小样本 | 5-8d  | 可 resume、预算 pause、真实 LLM 3 章冒烟 | 是                           |
| 3    | 9C   | 长程质量、EPUB、审计 UI     | 7-11d | 3-5 万字短篇 + EPUB + 审计页             | 否，但阻塞“稳定生产级”宣称   |

---

## Phase 9 验证门禁

```powershell
# 基础门禁，每个阶段都必须保持通过
pnpm verify
pnpm test
pnpm e2e

# 9A 专属
cd apps/api
uv run pytest tests/test_blueprint_api.py tests/test_book_runs.py tests/test_book_exporter.py -q
cd ../workflow
uv run pytest tests/test_chapter_planner.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py -q

# 9B 专属
cd apps/api
uv run pytest tests/test_book_run_resume.py tests/test_book_run_budget.py -q
cd ../workflow
uv run pytest tests/test_book_loop_resume.py tests/test_provider_degradation_pause.py -q

# 9C 专属
cd apps/api
uv run pytest tests/test_context_compiler_memory_injection.py tests/test_character_bible_guard.py tests/test_timeline_consistency.py tests/test_book_export_epub.py -q
```

远端要求：每个阶段合并前，GitHub Actions 的 `CI` 与 `E2E` 必须在 `master` push 或 PR 上通过。

### 当前远端门禁状态

- 最新远端 `CI` run `26857864662` 已成功，只覆盖 `CI / Core verification`。
- 历史远端 `master` 定时 `E2E` run `26915457170`（2026-06-03T21:55:39Z）曾失败，失败点为 `uv run alembic upgrade head`，错误为 `Multiple head revisions`。
- 修复分支 `codex/phase9-e2e-alembic` 的远端 `E2E` run `26941784868`（2026-06-04T08:59:00Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功；`执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success。
- 修复分支已非强制快进合入远端 `master`；最新远端 `master` E2E run `26944063055`（2026-06-04T09:45:05Z，head `590333f1ccc99234f4244bc7bf4556fd7dee3f4f`）已成功；`执行 Alembic 迁移预检`、`执行数据库迁移`、`运行 E2E` 均为 success。
- 本地已新增 Alembic merge revision `20260604_0001` 合并 `20260514_phase2` 与 `20260602_0003`，并将 `tests/test_alembic_heads.py` 纳入本地 `pnpm e2e` 的 `API verification` 预检；在线 PostgreSQL 迁移已在本轮复验，临时库 `storyforge_phase9_online_verify` 执行 `uv run alembic upgrade head` 与 `uv run alembic current --check-heads` 均退出码为 0，验证后已删除。
- 真实 10 章 smoke 已完成最终验收，证据目录为 `.codex/real-llm-10ch-20260604-110831`，最终门禁输出 `gate: pass_for_real_10ch_final_acceptance`。
- 主分支远端 `E2E` 已通过；真实 3-5 万字长程仍未完成。

---

## Phase 9 风险与缓解

| 风险                       | 影响                    | 缓解措施                                                       |
| -------------------------- | ----------------------- | -------------------------------------------------------------- |
| 9A 范围再次膨胀            | 第一本文本迟迟产不出来  | EPUB、复杂审计 UI、Style Guard、Timeline 全部后置到 9C         |
| LLM 输出不稳定导致测试脆弱 | CI 不可重复             | 9A 全部用 deterministic/mock provider，真实 LLM 只进入 9B 冒烟 |
| Repair 死循环              | BookRun 卡死            | 9A 就设置 retry 上限，耗尽后 awaiting_review                   |
| 成本失控                   | 真实 LLM 冒烟烧预算     | 9B 前不得跑长文本真实 LLM；预算硬上限必须先实现                |
| checkpoint 体积膨胀        | resume 慢且数据库压力大 | 9B checkpoint 只存引用 id，体积超过 5MB 直接失败               |
| 长程一致性系统过早复杂化   | 阶段拖慢                | 9C 前只保留最小证据索引，不做 Character Bible/Timeline         |

---

## Phase 9 完成判定

### 可以宣称“StoryForge 能产出一本最小可审计小说”的条件

必须完成 9A 和 9B，并满足：

1. deterministic/mock provider 下 3 章 BookRun 自动 completed。
2. 真实 LLM 下 3 章 BookRun 自动 completed。
3. `book.md` 可读，`audit_report.json` 完整。
4. 本地 `pnpm verify && pnpm test && pnpm e2e` 通过。
5. 远端 `CI` 与 `E2E` 通过。
6. `.codex/verification-report.md` 有完整证据。

### 可以宣称“StoryForge 具备稳定长篇生产闭环”的条件

必须完成 9C，并满足：

1. 跑完一部 3-5 万字短篇。
2. 导出 Markdown 与 EPUB。
3. 审计页能回放关键事件。
4. 人工通读无明显人物、世界观或时间线矛盾。
5. `docs/internal/current-phase.md` 与 README 同步更新能力边界。

在此之前，禁止对外宣称 StoryForge 已经具备稳定生产级整本小说生成能力。
