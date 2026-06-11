## 项目上下文摘要（storyforge-vscode-ide）

生成时间：2026-05-28 03:50:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/studio/router.py`
  - 模式：领域目录内提供 `router.py`、`schemas.py`、`service.py`，路由前缀直接写 `/api/<domain>`，通过 `SessionDependency` 注入数据库会话。
  - 可复用：`SessionDependency`、`HTTPException`、`status`、服务层异常转换。
  - 需注意：路由文案与注释使用简体中文。
- **实现2**: `apps/api/app/domains/studio/service.py`
  - 模式：服务层用 SQLAlchemy `select` 查询 ORM 模型，返回 Pydantic schema，不在路由中拼业务数据。
  - 可复用：`Book`、`Chapter`、`Scene`、`JudgeIssue` 查询方式。
  - 需注意：列表排序使用业务字段再按 id 稳定排序。
- **实现3**: `apps/web/components/site-nav/Chrome.tsx` 与 `apps/web/app/page.tsx`
  - 模式：Next App Router 页面直接渲染组件，复杂界面组件放在 `apps/web/components` 下，测试多为 `node:test` + 源码/SSR 断言。
  - 可复用：深色 Tailwind 风格、`data-testid`、Server Component 默认导出页面。
  - 需注意：当前项目没有 `apps/web/src`，计划中的 Web 文件需适配到 `apps/web/components/ide`，保留计划目标但遵循现有组织。

### 2. 项目约定

- **命名约定**: Python 文件 snake_case，Pydantic/ORM 类 PascalCase；React 组件 PascalCase，工具函数 camelCase。
- **文件组织**: API 按 `apps/api/app/domains/<domain>/` 分层；Web 当前按 `apps/web/app` 与 `apps/web/components` 分层；Shared 源码在 `packages/shared/src`。
- **导入顺序**: `from __future__ import annotations` 优先；标准库、第三方、本项目分组；TypeScript 使用单引号。
- **代码风格**: Python 使用类型标注与简体中文 docstring；TS/TSX 使用严格类型、Tailwind className。

### 3. 可复用组件清单

- `app.db.deps.SessionDependency`: API 路由数据库依赖。
- `app.domains.books.models.Book/Chapter/Scene`: IDE 工作区树与诊断入口数据源。
- `app.domains.judge.models.JudgeIssue`: Diagnostic 映射来源。
- `apps/web/components/diff-viewer/RepairDiffViewer.tsx`: 既有 diff 展示模式，可作为 IDE DiffViewer 参考。
- `packages/shared/src/index.ts`: shared 导出入口。

### 4. 测试策略

- **测试框架**: API 使用 pytest + FastAPI TestClient；Web/shared 使用 `node:test`/`tsc --noEmit`；E2E 当前为 `node:test` 契约检查，不是真浏览器 Playwright。
- **测试模式**: API 创建内存 SQLite 数据；Web 多用 SSR 或源码断言；E2E 检查 OpenAPI、源码与测试证据。
- **参考文件**: `apps/api/tests/conftest.py`、`apps/api/tests/test_judge_repair.py`、`apps/web/tests/diff-viewer.test.tsx`、`tests/e2e/phase1-closed-loop.spec.ts`。
- **覆盖要求**: 正常流程、空状态/未知命令、映射边界。

### 5. 依赖和集成点

- **外部依赖**: Next 15、React 19、FastAPI、SQLAlchemy、Pydantic、node:test。计划提到 zustand/CodeMirror，但当前先检查是否可用，必要时安装。
- **内部依赖**: `main.py` 注册 IDE router；Web `/ide` 页面引入 IDE shell；Shared diagnostic 供 Web 与 tests 使用。
- **集成方式**: API `/api/ide/*`；Web query string 驱动初始 IDE 状态；shared 通过 workspace package 引用。
- **配置来源**: `package.json` scripts、`apps/web/tsconfig.json`、API pytest fixtures。

### 6. 技术选型理由

- API 沿用领域分层，最小侵入主应用。
- Web 适配现有 `components` 目录，避免新建与项目实际结构冲突的 `src` 根目录。
- 测试沿用项目当前 `node:test` 和 pytest，避免新增测试运行器假设。

### 7. 关键风险点

- 当前 `master` 有无关未提交改动，实施中必须避免覆盖。
- `operations-log.md` 曾被占用，后续写日志如失败需改用临时文件或重试。
- 计划命令包含 `vitest`/Playwright，但当前项目未配置，需用现有测试框架达成等价验证并记录。
- `pnpm openapi` 可能更新 shared contract，需要验证并记录 diff。
