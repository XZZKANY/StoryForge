## 项目上下文摘要（legacy-fixes）

生成时间：2026-05-21 17:33:06 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/phase1-navigation.test.tsx`
  - 模式：使用 `node:test`、`node:assert/strict` 和源码文本断言验证前端结构契约。
  - 可复用：`read(path)`、`activeRoutes`、薄入口和 Server Action 闭环断言。
  - 需注意：测试直接读取 UTF-8 文本，适合增加连续问号编码损坏检查。
- **实现2**: `apps/web/app/retrieval/page.tsx` 与 `apps/web/app/runs/page.tsx`
  - 模式：Server Component 内定义类型、读取函数、类型守卫和渲染逻辑，使用 `buildApiUrl` 与 API Key 头。
  - 可复用：`buildApiUrl`、`fetch(..., { cache: "no-store" })`、中文错误文案、`parsePositiveInt` 风格。
  - 需注意：Studio 拆分后要保持原请求顺序和中文 UI 文案。
- **实现3**: `apps/api/app/domains/studio/router.py`
  - 模式：FastAPI router 以 `/api/studio` 聚合 Studio 真实链路，服务层异常转换为 HTTP 404。
  - 可复用：现有 8 个 Studio endpoint 与 schema/service 契约。
  - 需注意：API router 精简应保留 Studio、Judge、Repair、Retrieval、ModelRuns 等前端仍使用链路。
- **实现4**: `apps/api/app/domains/judge/service.py` 与 `apps/api/tests/test_judge_semantic.py`
  - 模式：Judge service 先校验场景与 Scene Packet，再生成 `DetectedIssue` 并写库；测试用 FastAPI TestClient 与内存 SQLite。
  - 可复用：`DetectedIssue`、`deterministic_judge_fallback`、`_find_field_conflict`、`conftest.py` 本地数据库夹具。
  - 需注意：现有 `semantic_judge(payload)` 直接读环境并发 HTTP，不便注入 provider。
- **实现5**: `apps/workflow/tests/test_generation_graph.py` 与 `apps/workflow/tests/test_runtime_runner.py`
  - 模式：pytest + monkeypatch 固定 LLM 输出；显式测试替身使用 `InMemoryWorkflowStore` 和运行器 checkpoint store。
  - 可复用：`initial_generation_state`、`checkpoint_reference_state`、运行器 start/resume 断言。
  - 需注意：生产默认不应再创建 `InMemorySaver()` 或仅内存 `RuntimeCheckpointStore()`。

### 2. 项目约定

- **命名约定**: TypeScript 使用 PascalCase 类型、camelCase 函数和常量；Python 使用 snake_case 函数、PascalCase 类。
- **文件组织**: Next App Router 页面位于 `apps/web/app/*/page.tsx`；API domain 采用 `router.py`、`service.py`、`schemas.py` 分层；workflow runtime 位于 `storyforge_workflow/runtime`。
- **导入顺序**: Python 先 `from __future__ import annotations`，再标准库、第三方、项目模块；TypeScript 先外部依赖再项目相对导入。
- **代码风格**: 中文注释和文案；pytest 测试函数以 `test_` 开头；前端契约测试使用 `node:test`。
### 3. 可复用组件清单

- `apps/web/lib/api-client.ts`: `buildApiUrl`、`readJson` 和 API Key 注入。
- `apps/web/app/components/scene-packet/ScenePacketPanel`: Studio 页面现有 Scene Packet 展示组件。
- `apps/api/tests/conftest.py`: API 测试的内存 SQLite、Session 和 TestClient 夹具。
- `apps/api/app/domains/judge/service.py`: `DetectedIssue` 与确定性 fallback 结构。
- `apps/workflow/storyforge_workflow/state.py`: `checkpoint_reference_state` 强制引用化状态。
- `apps/workflow/storyforge_workflow/persistence.py`: 审计记录数据结构和摘要函数。

### 4. 测试策略

- **前端测试框架**: `pnpm --filter @storyforge/web test` 调用 `node scripts/phase1-contract-test.mjs`，转译 `tests/phase1-navigation.test.tsx` 后用 Node test runner 执行。
- **API 测试框架**: `uv run pytest`，使用 `apps/api/tests/conftest.py` 的本地 SQLite 与依赖覆盖。
- **Workflow 测试框架**: `uv run pytest`，使用 monkeypatch 避免真实 LLM。
- **本任务测试**: 增加编码损坏断言、Studio 真拆分断言、Judge provider stub 断言、SQLite checkpoint 持久化断言、router 注册面断言。

### 5. 依赖和集成点

- **外部依赖**: Next 15、React 19、FastAPI、SQLAlchemy、pytest、LangGraph、langgraph-checkpoint。
- **Context7 结果**: LangGraph 官方文档说明 `builder.compile(checkpointer=checkpointer, store=store)`；默认内存 saver 仅示例持久化线程，生产持久化应接入 saver/store。
- **GitHub 检索**: 本会话未暴露 `github.search_code` 工具，已记录为工具缺失并用 Context7 与项目内实现替代。
- **配置来源**: `STORYFORGE_API_BASE_URL`、`STORYFORGE_API_KEY`、`STORYFORGE_JUDGE_LLM_*`、新增 `STORYFORGE_WORKFLOW_SQLITE_PATH`。
### 6. 技术选型理由

- **Studio 拆分**: 采用现有模块名 `types.ts`、`validators.ts`、`api.ts`，新增 `page-content.tsx` 承载渲染，保持 page 薄入口和 Server Action 写回闭环。
- **Judge provider**: 增加可注入 provider，测试可 stub JSON 响应；远程失败或无配置回落到本地 fallback。
- **Workflow SQLite**: 当前未安装官方 sqlite/postgres/redis saver 模块，使用标准库 `sqlite3` 实现窄范围持久化，避免新增依赖和内存丢状态。
- **Router 精简**: 只移除注册面，不删除 domain 目录，降低误伤内部服务依赖风险。

### 7. 关键风险点

- **并发问题**: SQLite 写入需要每次打开连接并提交，避免跨线程共享连接。
- **边界条件**: Judge LLM 返回非法 JSON、越界 span 或空数组时必须 fallback。
- **性能瓶颈**: checkpoint 只保存 `checkpoint_reference_state` 后的小对象，避免大文本写入。
- **安全考虑**: 本任务仅按既有项目准则处理暴露面精简，不新增认证或鉴权设计。

### 8. 充分性检查

- 能定义接口契约：是，Studio、Judge、RuntimeCheckpointStore、router 注册面均有现有契约。
- 理解技术选型：是，SQLite 作为当前环境默认持久化替代内存实现。
- 识别风险点：是，主要风险为请求顺序、provider fallback、SQLite 写入和 OpenAPI 注册面。
- 知道如何验证：是，沿用前端 Node test、API pytest、workflow pytest 与 OpenAPI 生成。
