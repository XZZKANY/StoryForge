# StoryForge current architecture map

生成时间：2026-06-15 +08:00

StoryForge 采用 IDE-first 产品方向：Desktop IDE 是当前主体验，旧 Web 入口已退场，API 和 Workflow 继续作为共享后端能力。

## 产品入口

- `apps/desktop`：主产品入口。Tauri + Vite + Monaco，负责本地文件、编辑器、Assistant、菜单和桌面集成。
- `apps/web`：已退场。历史 Next.js 页面只保留在 git 历史和归档文档中，不再参与运行、容器、验证或当前产品入口。

## 后端能力

- `apps/api`：FastAPI 业务 API、OpenAPI、数据库模型、BookRun、Artifacts、IDE BFF 和运行记录。
- `apps/workflow`：长篇生成工作流、章节调度、provider adapter、checkpoint 和质量门禁。
- `packages/shared`：OpenAPI 生成类型、共享契约和诊断工具。

## 事实源

- 当前阶段事实：`docs/internal/current-phase.md`
- 产品方向决策：`docs/architecture/ide-first-product-direction.md`
- 本地启动：`docs/operations/local-start.md`
- Desktop 使用：`apps/desktop/README.md`
