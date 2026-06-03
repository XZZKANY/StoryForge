# 项目上下文摘要（project-review 优化后）

生成时间：2026-05-23 00:00:00 +08:00

## 1. 本轮目标

本轮基于上一轮项目级审查的“需讨论”结论继续优化，重点处理以下风险：Web 统一 API client 复用、Artifacts 域能力描述、Runs 页面文案编码、Workflow 测试临时目录、verify 与 e2e 补偿路径。

执行约束：不开子代理；所有回复和记录使用简体中文；验证均在本地执行；不把未通过的环境门禁伪装为通过。

## 2. 相似实现与复用证据

- `apps/web/lib/api-client.ts`：统一 `apiFetch()`、`readJson()`、`buildApiUrl()`，负责 API Key 注入和 `cache: "no-store"`。
- `apps/web/app/studio/actions.tsx`：Server Action 复用 `apiFetch()` 执行写回请求。
- `apps/web/app/artifacts/page.tsx` 与 `apps/web/app/evaluations/page.tsx`：页面读取复用 `readJson()`，作为 Runs 页面读取模式参考。
- `apps/web/tests/phase1-navigation.test.tsx`：既有 node:test 静态契约测试，适合扩展编码损坏回归检测。

## 3. 官方文档与外部检索

- 已通过 context7 查询 Next.js App Router 数据读取文档：Server Component 中动态服务端读取可使用 `fetch(..., { cache: "no-store" })`。
- 本项目进一步把该模式封装在 `apiFetch()` 中，以避免页面重复维护 header、cache 和 URL 拼接。
- 本轮可用工具列表中没有 `github.search_code` 工具，因此未执行开源代码搜索；已在操作日志中记录该限制。

## 4. 当前代码状态

- `apps/web/app/retrieval/page.tsx` 已使用 `apiFetch()`，不再保留裸业务 `fetch()`。
- `apps/web/app/runs/page.tsx` 已使用 `readJson()`，并修复缺少 `job_run_id`、响应格式异常和 API 错误前缀的中文文案。
- `apps/api/app/domains/artifacts/__init__.py` 当前描述为“制品治理域：当前提供导出物列表、详情和 payload 下载摘要。”，未再声明上传资料、快照和评测报告已统一管理。
- `apps/workflow/pyproject.toml` 已移除固定 `--basetemp=.pytest-tmp`，避免 Windows 上 pytest 清理固定目录时因权限或句柄残留失败。

## 5. 测试策略

- Web 使用 `node:test` + 静态源码契约检查，并由 `pnpm.cmd run test:web` 同时执行 shared TypeScript 检查。
- API 使用 `uv run pytest`，本轮在项目内 `UV_CACHE_DIR=.cache/uv` 下 147 项通过。
- Workflow 使用 `uv run pytest`，本轮 13 项通过。
- E2E 使用 `scripts/run-e2e.mjs`，会先刷新 OpenAPI，再执行 Node 契约测试、API 验证和 Workflow 验证。

## 6. 本轮验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm.cmd run test:web` | 通过 | Web 7/7，shared 类型检查通过 |
| `UV_CACHE_DIR=.cache/uv; pnpm.cmd run test` | 通过 | Web 7/7、API 147/147、Workflow 13/13 |
| `UV_CACHE_DIR=.cache/uv; pnpm.cmd run e2e` | 通过但仍有补偿路径 | Node 契约 14/14，API 服务层补偿 7/7，Workflow 补偿 8/8 |
| `UV_CACHE_DIR=.cache/uv; pnpm.cmd openapi` | 通过 | OpenAPI 契约生成成功 |
| `git diff --check` | 通过 | 无空白错误，仅有 CRLF 提示 |
| `pnpm.cmd run verify` | 失败 | Docker 命令存在，但 PostgreSQL、Redis、MinIO 容器状态无法查询 |

## 7. 仍需讨论的风险

- `pnpm run verify` 仍未绿，原因是本地 Docker 容器状态查询失败；这仍是交付门禁风险。
- `pnpm run e2e` 虽通过，但当前环境仍无法稳定执行 FastAPI HTTP pytest，脚本转入 compileall + 服务层验收补偿路径。
- 多数工作台仍以摘要读取或最小执行为主，不能按“完整实现”标准直接通过。

## 8. 充分性检查

- 已能指出至少 3 个相似实现：`api-client.ts`、`studio/actions.tsx`、`artifacts/page.tsx`、`evaluations/page.tsx`。
- 已理解项目模式：Web 页面通过统一 API client 访问后端，静态契约测试约束页面边界与文案边界。
- 已复用既有组件：`apiFetch()`、`readJson()`、既有 `phase1-navigation.test.tsx` 测试结构。
- 已验证命名与风格：TypeScript 保持 camelCase，Python 配置保持项目既有 pyproject 结构。
- 已确认未重复造轮子：未新增 HTTP client、未新增测试框架、未新增脚本。

---

## 2026-06-02 本轮增量审阅

生成时间：2026-06-02 17:15:09 +08:00

### 1. 相似实现分析

- **实现1**：`apps/api/app/domains/book_runs/router.py:34`
  - 模式：FastAPI `APIRouter` + 薄路由 + service 业务函数 + Pydantic response_model。
  - 可复用：`BookRunCreate`、`BookRunRead`、`BookRunWorkflowDispatch`、`create_book_run()`、`apply_book_run_progress()`。
  - 需注意：BookRun 是整书闭环主链，状态、预算、checkpoint 和导出都在此聚合，剪枝时不能动摇。
- **实现2**：`apps/api/app/domains/assistant/router.py:19`
  - 模式：会话 router 只负责 HTTP 边界，service 负责持久化和最近记录查询。
  - 可复用：`create_assistant_session()`、`append_assistant_message()`、`list_recent_assistant_sessions()`。
  - 需注意：Assistant 当前是入口编排层，后续深化应绑定真实工具执行审计，避免只做 URL 状态回流。
- **实现3**：`apps/api/app/domains/worldbuilding/router.py:11`
  - 模式：只读聚合 endpoint + service 聚合 SeriesMemory、Asset、ContinuityRecord + Redis 缓存。
  - 可复用：`build_worldbuilding_center()`、`invalidate_worldbuilding_cache()`。
  - 需注意：当前已注册 router 并有测试，旧报告中“未注册”的判断已过期；但写入、冲突仲裁、时间线演化仍未实现。
- **实现4**：`apps/workflow/storyforge_workflow/orchestrators/novel_loop.py:48`
  - 模式：dataclass 请求/结果 + 端口注入 + 可选 skill runner，保护测试和生产 adapter 边界。
  - 可复用：`NovelLoopPorts`、`run_single_chapter_loop()`、`NovelSkillRunnerPort`。
  - 需注意：这是生成、Judge、Repair、Approve、Memory Extract 的核心执行协议。
- **实现5**：`apps/workflow/storyforge_workflow/orchestrators/book_loop.py:10`
  - 模式：顺序章节驱动 + checkpoint + token/time/chapter budget + provider fallback pause。
  - 可复用：`BookLoopRequest`、`BookLoopResult`、`run_book_loop()`。
  - 需注意：真实 LLM 深化应优先围绕这里补证据，不要横向扩新页面。
- **实现6**：`apps/web/lib/api-client.ts:32`
  - 模式：统一 `apiFetch()` 注入 `X-StoryForge-API-Key`，并强制 `cache: 'no-store'`。
  - 可复用：`readJson()`、`ApiResult<T>`、`buildApiUrl()`。
  - 需注意：这是 Web 访问 API 的核心门禁，页面绕过它需要审查。

### 2. 项目约定

- **命名约定**：Python 使用 snake_case 函数和 PascalCase schema/model；TypeScript 使用 camelCase 函数和 PascalCase 组件/类型。
- **文件组织**：API 领域基本按 `router.py`、`service.py`、`schemas.py`、`models.py` 拆分；Web 按 `app` 路由和 `components` 业务组件组织；Workflow 按 `orchestrators`、`runtime`、`skills`、`quality` 拆分。
- **导入顺序**：Python 遵循 ruff `I` 导入排序；TypeScript 由 eslint/prettier 管理。
- **代码风格**：Python ruff 行宽 120，TypeScript 使用 Prettier；项目文档、注释、错误提示应使用简体中文。

### 3. 可复用组件清单

- `apps/api/app/common/auth.py`：API Key 和 JWT 双模认证。
- `apps/api/app/common/middleware.py`：请求日志与安全响应头。
- `apps/api/app/common/redis_cache.py`：Redis JSON/value 缓存，Redis 不可用时降级为未命中。
- `apps/api/app/db/deps.py`：FastAPI session 依赖。
- `apps/web/lib/api-client.ts`：前端统一 API client。
- `packages/shared/src/generated/api-types.ts`：OpenAPI 生成类型。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`：单章闭环协议。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`：整书闭环协议。
- `apps/workflow/storyforge_workflow/skills/definitions.py`：小说技能静态契约。

### 4. 测试策略

- **测试框架**：API 与 Workflow 使用 pytest；Web 使用自制 Node/TypeScript 契约测试脚本；E2E 使用 Playwright/Node 合同测试和真实 API pytest 组合。
- **测试规模**：当前约 85 个 API pytest 文件、32 个 Web 测试文件、27 个 Workflow pytest 文件。
- **参考文件**：`apps/api/tests/test_book_runs.py`、`apps/api/tests/test_worldbuilding_center.py`、`apps/workflow/tests/test_novel_loop_single_chapter.py`、`apps/web/tests/home-page.test.tsx`。
- **覆盖要求**：正常流程、边界条件、失败恢复、OpenAPI 漂移和本地验证命令均需留痕。

### 5. 依赖和集成点

- **外部依赖**：FastAPI、Pydantic、SQLAlchemy、Alembic、Redis、SlowAPI、Sentry、Next.js、React、Zustand、LangGraph、openapi-typescript。
- **内部依赖**：API 是业务真相源；Web 通过 `api-client.ts` 读取 API；Workflow 通过 dispatch payload 和 progress sink 与 BookRun 集成；shared 通过 OpenAPI 快照提供类型契约。
- **集成方式**：HTTP API、OpenAPI 生成类型、BookRun workflow dispatch、Redis 缓存、SQLite/运行态 checkpoint。
- **配置来源**：根 `.env.example`、`apps/api/app/common/config.py`、`apps/web/lib/api-client.ts` 默认值、Workflow 环境变量。

### 6. 技术选型理由

- **为什么用这个方案**：FastAPI router/service/schema 适合多领域 API；Next App Router 适合服务端读取和工作台页面；LangGraph/Workflow 适合长任务、checkpoint 与人机协同。
- **优势**：本地验证门禁完整，BookRun 审计链路清晰，状态引用化避免全文塞进 checkpoint，README 能诚实限制能力声明。
- **劣势和风险**：领域数量和页面入口已经偏多；`.codex` 与历史计划材料噪声大；Web 自制测试转译脚本维护成本高；真实 LLM 长篇能力仍缺最终证据。

### 7. 关键风险点

- **并发问题**：BookRun progress 回填、Redis 缓存失效、Workflow checkpoint 恢复需要继续覆盖竞态和重复提交。
- **边界条件**：缺少真实 LLM 环境、BookRun 非 completed 导出、世界观缺少 series/book 参数、API 返回格式异常。
- **性能瓶颈**：Context/Scene Packet/Retrieval 链路涉及检索、证据、预算裁剪和缓存，是当前最重路径。
- **安全考虑**：认证、限流、请求超时、安全头和默认凭据告警已有基线；剪枝不得削弱这些门禁。

### 8. 外部资料来源

- Context7 `/fastapi/fastapi`：确认 APIRouter 模块化、CORS、依赖覆盖和 TestClient 模式。
- Context7 `/vercel/next.js`：确认 App Router 中 `fetch(..., { cache: 'no-store' })` 的动态读取语义。
- Context7 `/websites/langchain_oss_python_langgraph`：确认 StateGraph 与 checkpointer 支持持久化、长任务和人机协同。
- GitHub code search：Next.js 官方仓库与 LangGraph 相关实现可作为生态方向参考；FastAPI 精准模板搜索命中有限，未作为强证据使用。

### 9. 上下文充分性检查

- 能说出至少 3 个相似实现路径：是，见 BookRun、Assistant、Worldbuilding、NovelLoop、BookLoop、api-client。
- 理解项目实现模式：是，核心是 API 真相源、Web 工作台、Workflow 长任务、shared OpenAPI 契约。
- 知道可复用工具函数/类：是，见第 3 节。
- 理解命名和风格：是，见第 2 节。
- 知道如何验证：是，根命令 `pnpm verify`，分层命令 `pnpm run test:web`、`pnpm run test:api`、`pnpm run test:workflow`。
- 确认没有重复造轮子：是，本轮未实现新功能，只做审阅；建议优先复用现有 BookRun/NovelLoop/ScenePacket/Shared 契约。
- 理解依赖和集成点：是，见第 5 节。
