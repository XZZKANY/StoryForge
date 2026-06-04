# 项目上下文摘要（项目剪枝完善）

生成时间：2026-06-03 16:39:27 +08:00
项目根目录：D:\StoryForge

## 1. 本次任务边界

- 用户目标：为后续“剪枝和完善项目”建立低上下文消耗的记录文档，并支持分发给子代理并行分析。
- 本次不直接删除、移动或重构业务代码。
- 本次只新增/更新项目本地 .codex/ 下的协作记录，不触碰 pps/、packages/、docs/ 的业务实现。
- desktop-commander 未在当前工具列表暴露；已记录缺口并使用 PowerShell 做本地只读扫描与文档写入。

## 2. 仓库结构事实

顶层结构扫描结果：

- pps/api：Python API 服务，存在 pp/、lembic/、	ests/、Dockerfile。
- pps/web：Next.js Web 应用，存在 pp/、components/、lib/、	ests/、
ext.config.ts。
- pps/workflow：Python 创作工作流运行时，存在 storyforge_workflow/、	ests/、Dockerfile。
- packages/shared：共享契约与生成类型，存在 src/contracts、src/generated。
- docs：架构、API、运维和 superpowers 设计文档。
- .codex：大量本地上下文摘要、日志、截图、真实/模拟运行制品和临时浏览器 profile。

## 3. 技术栈与验证入口

来自 D:\StoryForge\package.json：

- 包管理器：pnpm@9.15.4
- 总验证：pnpm run verify → pnpm run verify:ci
- 本地基础设施验证：pnpm run verify:infra
- 总测试：pnpm run test
- 分层测试：pnpm run test:web、pnpm run test:api、pnpm run test:workflow
- E2E：pnpm run e2e
- OpenAPI：pnpm run openapi
- Lint：pnpm run lint、pnpm run lint:fix

来自 Python 项目配置：

- pps/api/pyproject.toml：FastAPI、Pydantic、SQLAlchemy、Alembic、Redis、pytest、ruff。
- pps/workflow/pyproject.toml：LangGraph、Pydantic、Redis、Postgres、pytest、ruff。
- Python 目标版本：>=3.11。
- Ruff 行宽：120，规则集包含 E/F/W/I/UP/B/SIM，忽略 E501。

## 4. 现有测试模式

业务测试主要位于：

- D:\StoryForge\apps\api\tests
- D:\StoryForge\apps\workflow\tests
- D:\StoryForge\apps\web\tests
- D:\StoryForge\packages\shared 通过 pnpm --filter @storyforge/shared test 验证。

API 测试覆盖面很广，示例包括：

- 	est_book_runs.py
- 	est_phase9a_deterministic_smoke.py
- 	est_phase9b_real_llm_smoke.py
- 	est_provider_gateway.py
- 	est_story_memory_persistence.py
- 	est_quality_dashboard.py

## 5. 已识别的剪枝候选区域

仅作为候选，执行前必须由对应子代理复查并给出删除/保留证据：

- .codex/tmp/ 下浏览器 profile、Cache、GPUCache、CrashpadMetrics 等临时制品。
- .codex/uiux-*.png、.codex/*dev*.log、.codex/*smoke*.sqlite* 等本地验证制品。
- 根目录历史补丁：.codex-fix-phase9b-*.patch 与 .local.patch。
- TypeScript 构建缓存：pps/web/tsconfig.tsbuildinfo。
- .pytest_cache、.ruff_cache、__pycache__、.next、.venv、
ode_modules 等依赖或缓存目录。
- 重复或过期的 .codex/context-summary-*.md、真实 LLM 运行产物目录，需要先按日期与任务关联归档，不可直接删除。

## 6. 关键约束与风险

- 当前 git status --short 显示已有用户/历史未提交改动，后续子代理不得覆盖不属于自己任务的文件。
- README.md 明确：不能宣称真实 LLM 下 3 章 BookRun 已稳定 completed，除非补齐真实运行证据。
- Web App Router 下 pps/web/app/**/page.tsx、layout.tsx、oute.ts 属于路由契约，剪枝时不能按普通死文件处理。
- packages/shared/src/contracts/storyforge.openapi.json 与 packages/shared/src/generated/api-types.ts 是共享契约/生成类型，删除或重生成前必须先跑 pnpm openapi 并解释 diff。
- .codex/operations-log.md 当前体积较大，后续应追加索引型摘要，避免粘贴长日志。

## 7. 外部参考记录

- GitHub 代码搜索：epo hygiene checklist monorepo pruning language:Markdown，用途是参考“仓库卫生/剪枝检查清单”类文档结构，不复制外部内容。
- Context7：查询 /vercel/next.js App Router 项目结构；关键结论是 pp 目录嵌套文件夹承载路由段，只有 page/oute 等约定文件形成公开路由，剪枝时必须保护这些路由契约。

## 8. 上下文充分性结论

- 可以定义后续子代理输入/输出协议：是。
- 可以列出项目模块边界：是，API/Web/Workflow/Shared/Docs/.codex。
- 可以定义验证方式：是，依据 package.json 与 Python pyproject.toml。
- 可以识别主要风险：是，包括未提交改动、真实 LLM 能力声明、生成契约、路由契约和本地制品误删。