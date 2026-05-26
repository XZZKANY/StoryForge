## 项目上下文摘要（项目体检）

生成时间：2026-05-25 19:30:50 +08:00

### 1. 项目定位与技术栈

- 仓库根目录：`D:\StoryForge\1-renovel-ai-ai-rag-tavern`。
- 项目定位：`README.md` 将 StoryForge 定义为“面向长篇小说生产的可验证创作流水线”。
- 包管理与工作区：根 `package.json` 使用 `pnpm@9.15.4`，`pnpm-workspace.yaml` 包含 `apps/*` 与 `packages/*`。
- Web：`apps/web/package.json` 使用 Next.js 15.3.2、React 19.1.0、TypeScript 5.8.3、Tailwind CSS 4.3.0。
- API：`apps/api/pyproject.toml` 使用 FastAPI、Pydantic、SQLAlchemy、Alembic、psycopg、Redis、pytest。
- Workflow：`apps/workflow/pyproject.toml` 使用 LangGraph、Pydantic、Redis、psycopg、pytest。

### 2. 相似实现分析

- **实现1**：`apps/web/app/studio/page-content.tsx`
  - 模式：Server Component 聚合读取状态，组装四步 StudioFlow。
  - 可复用：`ScenePacketPanel`、`JudgeIssueList`、`RepairDiffViewer`、`readJson`。
  - 需注意：文件 348 行，页面承担较多流程编排与视图拼装责任。
- **实现2**：`apps/web/app/retrieval/page.tsx`
  - 模式：页面内定义局部类型、读取函数、类型守卫和渲染。
  - 可复用：统一 `apiFetch` 注入 API Key 与 `cache: "no-store"`。
  - 需注意：页面 280 行，局部读取逻辑与 Studio 的 `readJson` 模式不完全统一。
- **实现3**：`apps/web/app/worldbuilding/page.tsx`
  - 模式：只读聚合页面，通过 `readJson` 读取 `/api/worldbuilding/center`。
  - 可复用：`readJson` 与页面级 `status` 联合类型。
  - 需注意：缺少参数时只能提示 `series_id`，没有从现有作品上下文引导选择。
- **实现4**：`apps/api/app/domains/worldbuilding/router.py` 与 `service.py`
  - 模式：FastAPI router 只做参数和异常映射，业务聚合放在 service。
  - 可复用：`SessionDependency`、领域异常、Pydantic response model。
  - 需注意：API 分层清晰，是后续新增端点应沿用的模式。

### 3. 项目约定

- 命名约定：TypeScript 使用 PascalCase 组件、camelCase 函数和变量；Python 使用 snake_case 函数与文件。
- 文件组织：Web 位于 `apps/web/app` 与 `apps/web/components`；API 按 `apps/api/app/domains/<domain>` 分 router/service/schema/model；共享契约位于 `packages/shared/src/contracts`。
- 数据读取：Web 业务请求应通过 `apps/web/lib/api-client.ts` 的 `apiFetch` 或 `readJson`。
- 样式方式：全局基础样式在 `apps/web/app/globals.css`，局部状态样式多使用 Tailwind className。

### 4. 测试策略

- 根脚本：`pnpm run test` 串联 Web、API、Workflow。
- Web：`apps/web/scripts/phase1-contract-test.mjs` 运行 `apps/web/tests/phase1-navigation.test.tsx`，当前偏静态契约测试。
- API：`apps/api/pyproject.toml` 配置 pytest，当前本地执行 152 个测试通过。
- Workflow：`apps/workflow/pyproject.toml` 配置 pytest，当前本地执行 37 个测试通过。
### 5. 依赖和集成点

- Web 到 API：`apps/web/lib/api-client.ts` 默认连接 `http://127.0.0.1:8000`，并注入 `X-StoryForge-API-Key`。
- API 中间件：`apps/api/app/main.py` 为业务 API 校验 API Key，并公开 `/health`、`/openapi.json`、`/docs`、`/redoc`。
- OpenAPI 合同：`scripts/run-e2e.mjs` 与 `scripts/generate-openapi.ps1` 会刷新 `packages/shared/src/contracts/storyforge.openapi.json`。
- 运行依赖：`scripts/verify-local.ps1` 检查 Node、pnpm、Python、Docker、PostgreSQL、Redis、MinIO。

### 6. 官方文档基准

- 使用 Context7 查询 `/vercel/next.js`：Next.js App Router 支持在 async Server Component 中进行动态数据读取，`fetch` 可使用 `cache: "no-store"`；`loading.tsx` 用于在路由加载时提供即时反馈。
- 对照结论：项目的 `apiFetch` 统一设置 `cache: "no-store"`，且存在 `app/loading.tsx` 与 `app/error.tsx`，方向正确。

### 7. 关键风险点

- 功能产品化风险：README 明确写明 Studio 不是全步骤编排器，Retrieval、Runs、Artifacts、Evaluations 仍有未联通能力。
- 界面体验风险：页面内容密度高，很多区域仍是原生 `dl`、`ul`、`section` 直接堆叠，缺少统一产品级组件体系。
- 代码维护风险：部分页面内联类型、读取函数、校验函数较多，长期会造成页面膨胀。
- 验证盲区：测试覆盖强，但 Web 侧主要是静态契约测试，缺少真实浏览器截图或交互冒烟证据。
