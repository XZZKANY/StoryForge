# 项目上下文摘要（工作流审查）

生成时间：2026-05-31 21:57:33 +08:00

## 1. 相似实现分析

- **实现 1**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：顺序驱动每章 NovelLoop，按 checkpoint、章节预算、token 预算和 provider 降级门禁返回 `BookLoopResult`。
  - 可复用：`BookLoopRequest`、`BookLoopResult`、`run_book_loop()`、`_checkpoint_entry()`。
  - 需注意：进度里同时保存 `completed_chapters` 和 `checkpoint`，应继续保持引用型 checkpoint，避免把完整正文或完整上下文塞入运行态。
- **实现 2**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：端口注入式单章闭环，`compile_context -> generate -> judge -> repair -> approve -> memory_extract`。
  - 可复用：`NovelLoopPorts`、`NovelSkillRunnerPort`、`run_single_chapter_loop()`。
  - 需注意：默认 `_skip_memory_extraction()` 是显式跳过语义；不能把跳过伪装为真实记忆写入。
- **实现 3**: `apps/workflow/storyforge_workflow/runtime/checkpoints.py`
  - 模式：运行时状态进入 SQLite 前调用 `checkpoint_reference_state()` 做引用化，另以 `RuntimeModelRunRecord` 和 `ModelRunPayload` 分离模型调用摘要。
  - 可复用：`RuntimeCheckpointStore`、`ApiModelRunAdapter`、`ModelRunPayload.to_api_payload()`。
  - 需注意：`job_run_id` 在 workflow 是字符串，在 API 真表是正整数，adapter 已显式校验，后续不能混用。
- **实现 4**: `apps/api/app/domains/book_runs/service.py`
  - 模式：API 侧是 BookRun 真相源，负责创建、进度回填、暂停、停止、resume 和 retry checkpoint。
  - 可复用：`create_book_run()`、`apply_book_run_progress()`、`resume_book_run()`、`retry_book_run_from_checkpoint()`。
  - 需注意：retry 当前只把状态改回 running 并记录恢复点，不等于立即续跑 workflow。

## 2. 项目约定

- **命名约定**：Python 使用 snake_case 函数和 dataclass；TypeScript 使用 camelCase 函数、PascalCase 组件；测试以 `test_` 或 `test()` 声明。
- **文件组织**：API 领域模块在 `apps/api/app/domains/*`；workflow 编排和运行态在 `apps/workflow/storyforge_workflow/*`；Web 页面级读取在 `apps/web/app/*`，共享契约在 `packages/shared/src/contracts/storyforge.openapi.json`。
- **导入顺序**：Python 使用 future、标准库、第三方、项目内模块；TypeScript 使用类型导入和本地模块导入。
- **代码风格**：Python 由 Ruff 管理，行宽 120；Web/Shared 由 TypeScript、ESLint、Prettier 管理。

## 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: BookRun 顺序编排与预算暂停逻辑。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`: 单章 generate/judge/repair/approve 闭环。
- `apps/workflow/storyforge_workflow/runtime/checkpoints.py`: Runtime checkpoint 与 ModelRun adapter 边界。
- `apps/api/app/domains/book_runs/service.py`: API 侧 BookRun 真相源与恢复控制。
- `apps/web/lib/api-client.ts`: Web 统一 API 访问头、`cache: "no-store"` 与错误状态。
- `scripts/verify-ci.mjs`: 当前核心本地门禁事实源。
- `scripts/run-e2e.mjs`: 当前 e2e 发布门禁事实源。

## 4. 测试策略

- **测试框架**：Python 使用 pytest；Web/Shared 使用 Node test 与 TypeScript；根门禁使用 pnpm 脚本。
- **测试模式**：API/Workflow 单元和契约测试覆盖正常、边界和错误恢复；e2e 脚本刷新 OpenAPI、检查漂移、运行契约测试、API HTTP pytest 和 workflow pytest。
- **参考文件**：
  - `apps/workflow/tests/test_book_loop_three_chapters.py`
  - `apps/workflow/tests/test_novel_loop_single_chapter.py`
  - `apps/api/tests/test_book_runs.py`
  - `tests/e2e/phase5-runtime-diagnostics.spec.ts`
- **覆盖要求**：本次审查重点覆盖根目录启动、核心 verify、e2e、BookRun/NovelLoop、checkpoint 和真实 LLM 缺口。

## 5. 依赖和集成点

- **外部依赖**：Next.js、React、FastAPI、SQLAlchemy、Alembic、LangGraph、pytest、Ruff、pnpm、uv。
- **内部依赖**：Web 依赖 OpenAPI 类型和 API 端点；API BookRun 依赖 Blueprint/Book/Chapter/Scene/ModelRun/Artifact；Workflow 通过端口或 adapter 与 API 真表对接。
- **集成方式**：根脚本统一调度；BookRun progress 使用 JSON checkpoint；ModelRun 使用 `ApiModelRunAdapter` 从 workflow 写入 API 真表。
- **配置来源**：`.env.example`、`apps/api/app/common/config.py`、`apps/workflow/storyforge_workflow/provider_client.py`、`docker-compose.yml`。

## 6. 技术选型理由

- **为什么用这个方案**：LangGraph 官方文档要求 durable execution 通过 checkpointer 和 thread id 保存状态；当前项目用 SQLite runtime checkpoint 和引用型状态，符合“状态保存进度、业务大对象放外部事实源”的方向。
- **优势**：本地可验证、缺真实 LLM 时仍能用 deterministic/mock 路径测试，API/Workflow/Web 边界清楚。
- **劣势和风险**：真实 LLM 与端到端生产闭环仍未完成；e2e 契约测试存在旧脚本字符串硬编码；文档与规范中存在互相冲突的约束。

## 7. 关键风险点

- **并发问题**：BookRun resume/retry 只是状态更新，未证明多 worker 或跨进程立即续跑。
- **边界条件**：目录上移后 `D:\StoryForge` 已是实际 package 和 git 根目录；迁移后的主要风险来自旧 junction、虚拟环境脚本或文档路径仍指向原内层目录。
- **性能瓶颈**：`phase9b_real_llm_smoke.py` 当前包含真实 LLM 冒烟、Judge、Repair、导出等大量逻辑，后续维护和定位成本高。
- **安全考虑**：仓库现有 API 明确实现 API Key、JWT、限流和安全响应头；但上位 `AGENTS.md` 要求删除安全控制，与当前代码和测试门禁冲突，必须剪枝规范而不是删除代码。

## 8. 修复后状态

- `tests/e2e/phase5-runtime-diagnostics.spec.ts` 已从旧 `verify-local.ps1` 字符串硬编码改为验证当前 `verify`、`verify:ci`、`verify:infra` 职责。
- 上位 `D:\StoryForge\AGENTS.md` 已改为不得删除、削弱或绕过已验证安全基线，旧安全冲突条款不再命中。
- `D:\StoryForge\README.md` 已作为当前项目根入口保留，降低从错误目录执行命令的风险。
- `pnpm e2e tests/e2e/phase5-runtime-diagnostics.spec.ts`、`pnpm run e2e`、`pnpm run verify` 已在迁移后的 `D:\StoryForge` 根目录通过。
