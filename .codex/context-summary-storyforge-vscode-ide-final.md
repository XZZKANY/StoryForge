# 项目上下文摘要（StoryForge VS Code 式创作 IDE P0-P7 最终复核）

生成时间：2026-05-28 11:29:05 +08:00

## 1. 任务与仓库状态

- 实际项目根目录：`D:\StoryForge\1-renovel-ai-ai-rag-tavern`。
- 最新提交：`330f286 完成 VS Code 式创作 IDE P0-P7`，已位于 `master` 和 `origin/master`。
- 工作区状态：存在未跟踪文件 `.codex/phase9b-real-llm-smoke-1ch.sqlite` 与 `.codex/visual-preview/`，本轮不修改这些既有未跟踪产物。
- 本轮目标：对 P0-P7 完成状态执行本地证据复核、补充上下文记录、运行本地验证并生成最终验证报告。

## 2. 相似实现分析

- `apps/web/components/ide/shell/IdeShell.tsx`：P0/P1 IDE 壳层模式，组合 `ActivityBar`、`SidePanel`、`EditorArea`、`RightDock`、`BottomPanel`，状态由 `createInitialIdeState` 初始化。
- `apps/api/app/domains/ide/router.py`：后端 IDE 聚合路由模式，以 FastAPI `APIRouter(prefix="/api/ide")` 暴露工作区树、诊断、上下文快照、记忆查询、制品预览、运行事件和命令执行。
- `apps/api/app/domains/ide/service.py`：服务聚合模式，复用 books、judge、story_memory、context_compiler、book_runs、artifacts 等既有领域能力，转换为 IDE 专用契约。
- `apps/web/components/ide/views/BookRunPanel.tsx`：P4 运行面板模式，展示进度、预算、checkpoint、阻塞章节、provider fallback 和命令入口。
- `apps/web/components/ide/views/ArtifactViewer.tsx`：P6 制品查看器模式，展示预览、下载摘要、版本列表和 BookRun → ModelRun → Approve 追溯链。

## 3. 项目约定

- 前端：Next.js App Router、React 19、TypeScript、Tailwind className，测试使用 `node:test`、`node:assert/strict` 与 `renderToStaticMarkup`。
- 后端：FastAPI + Pydantic + SQLAlchemy，测试使用 pytest 与 Starlette `TestClient`。
- 命名：TypeScript 组件 PascalCase，函数 camelCase；Python 函数 snake_case，测试函数 `test_*`。
- 文案与注释：按照 AGENTS.md 要求使用简体中文；现有 IDE 组件存在中英文混合产品术语，如 `StoryForge IDE`、`Activity Bar`、`BookRun`。
## 4. 可复用组件清单

- `apps/web/components/ide/url/ide-url-state.ts`：IDE URL 状态解析与序列化。
- `apps/web/components/ide/commands/registry.ts`：前端命令注册与执行抽象。
- `apps/web/components/ide/commands/registerBuiltinCommands.ts`：内置命令目录。
- `apps/web/components/ide/editors/extensions/judgeIssueDecorations.ts`：Judge 诊断到 CodeMirror 装饰的映射。
- `apps/api/app/domains/ide/schemas.py`：IDE API 响应与请求契约。
- `apps/api/app/domains/ide/service.py`：IDE 后端聚合服务。

## 5. 测试策略

- Web 单元/契约测试：`pnpm --filter @storyforge/web test`，入口为 `apps/web/scripts/phase1-contract-test.mjs`，覆盖 `apps/web/tests/ide-*.test.tsx` 与 `*.test.ts`。
- API 测试：`cd apps/api && uv run pytest tests/test_ide_*.py`，覆盖 IDE 工作区树、诊断、上下文快照、Story Memory、Run Events、命令、制品预览。
- E2E 契约测试：`node scripts/run-e2e.mjs tests/e2e/ide-shell.spec.ts tests/e2e/ide-judge-repair.spec.ts`，覆盖 `/ide` 壳层和 Judge 修复链路的源代码契约。
- 根级脚本：`package.json` 提供 `verify`、`test`、`e2e`、`lint`，本轮优先运行 IDE 相关子集，必要时再扩大范围。

## 6. 依赖和集成点

- 前端入口：`apps/web/app/ide/page.tsx` 读取 `searchParams` 并调用 `parseIdeUrlState`，再将状态传入 `IdeShell`。
- 后端入口：`apps/api/app/main.py` 纳入 IDE router，`apps/api/app/domains/ide/router.py` 统一暴露 `/api/ide/*`。
- 数据来源：Book/Chapter、JudgeIssue、CompiledContext、Story Memory、BookRun、Artifact 等既有领域模型与服务。
- 外部库：Next.js 15.3.2、React 19.1.0、CodeMirror 6、FastAPI、Pydantic、SQLAlchemy、pytest。

## 7. 文档与开源检索记录

- Context7 查询：已查询 `/vercel/next.js`，确认 Next.js App Router 当前 `searchParams` 可为 Promise，页面组件中应通过 `await searchParams` 读取；现有 `/ide/page.tsx` 写法与此一致。
- GitHub 代码搜索：当前会话通过 `tool_search` 未发现可用 `github.search_code` 工具，无法执行开源实现搜索；本轮以项目内实现、提交差异和 Context7 官方文档作为可追溯依据，并在操作日志中记录工具缺失。

## 8. 关键风险点

- 编码显示风险：部分文件通过工具读取时出现 `????` 文本，需要以本地测试结果判断是否影响契约；如测试通过，则作为非阻塞显示风险记录。
- 验证成本风险：完整 `pnpm run verify` 覆盖面大，可能受 Docker 或全量环境依赖影响；本轮先执行 IDE 直接相关验证。
- 未跟踪文件风险：已有 `.codex/phase9b-real-llm-smoke-1ch.sqlite` 与 `.codex/visual-preview/` 不属于本轮产物，不应误删或纳入结论。
