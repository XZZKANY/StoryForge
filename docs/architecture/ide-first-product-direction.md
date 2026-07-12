# IDE-first product direction

生成时间：2026-06-15 +08:00

## 决策

StoryForge = 作者辅助写作 IDE。主产品体验转为以 `apps/desktop` 为唯一入口的 Desktop IDE：本地小说项目、文件树、Monaco Editor、Agent 对话、审稿、修订、diff 确认、真实写回和版本记录都优先在桌面端完成。

`apps/web` 已完成退场，不再承担主体验、维护入口、调试入口、兼容入口或契约验证职责。写作、审稿、修订、长篇和短篇输出统一通过作者辅助 IDE 的 Writing Run 体验呈现；BookRun 只作为 managed full-book run 的内部兼容实现，不作为第一阶段主产品控制台。

## 背景

当前仓库同时存在两条前端主线：

- `apps/web`：旧 Next.js 工作台，曾承载 Home、Studio、Blueprints、Runs、Artifacts、IDE 等页面和大量契约测试，现已退场。
- `apps/desktop`：Tauri 桌面 IDE，正在形成本地文件树、Monaco Editor、Assistant 面板、原生菜单和本地文件系统能力。
- BookRun 控制台：保留后端长程生成能力，但用户侧表达为 managed Writing Run，不再作为第一阶段主产品入口。

继续让 Web IDE 和 Desktop IDE 同时作为主体验，会导致入口、文档、测试、端口、组件职责和用户心智持续分裂。因此需要明确产品重心。

## 职责边界

### Desktop IDE

`apps/desktop` 是面向创作者的唯一主体验，优先承载以下链路：

- 本地项目打开、文件树、编辑器、保存和监听。
- Assistant 对话、当前文件理解、章节审稿、定向修订和续写。
- proposed patch / diff 预览、用户确认、真实写回和版本记录。
- Writing Run 工具调用入口、轻量进度和 tool trace；不把 BookRun 控制台作为主界面。
- 与本地 API、workflow、文件系统和未来离线能力的集成。

第一阶段验收链路固定为：本地文件审稿 -> 修订 -> diff 确认 -> 真实写回 -> 版本记录。

### Agent tools / Writing Run engines

Judge、Repair、Story Memory、Timeline Guard、Style Guard、导出能力，以及 BookRun 兼容实现，都是 Agent 可调用工具或 Writing Run 引擎：

- managed Writing Run 负责长程生成、checkpoint、预算暂停、审计和制品导出；当前 full-book 实现仍落在 BookRun 兼容模块。
- Agent 可以解释将调用的工具、预算和风险，并把结果以 tool trace 或轻量面板反馈给 Desktop IDE。
- API / Workflow 负责后台运行记录、质量门禁和制品索引；不直接写用户本地文件。
- Tauri / Desktop 前端负责读取、diff 确认后的本地写回和版本记录。

### Web（已退场）

Web 不再承接运行时职责。历史 Next.js 页面、源码契约和 Docker 镜像不再作为当前门禁；需要用户界面的能力默认进入 Desktop IDE，需要后端观察能力默认进入 API/OpenAPI/pytest 或桌面端调试视图。

### API 和 Workflow

API 与 Workflow 继续作为共享后端能力，不绑定具体前端形态：

- `apps/api` 负责业务 API、OpenAPI、数据模型、运行记录和制品。
- `apps/workflow` 负责生成编排、checkpoint、provider adapter 和质量门禁。
- Desktop IDE、Agent orchestration 和 Writing Run 工具通过稳定契约访问这些能力。

## 迁移原则

1. 新功能默认落在 Desktop IDE。
2. 每迁移一条链路，补一条 Desktop IDE 级健康检查或端到端验证。
3. 后端契约由 API pytest、OpenAPI 快照、workflow pytest 和 shared 类型检查承接。
4. 文档以 `docs/architecture/ide-first-product-direction.md` 记录产品方向，以 `docs/internal/current-phase.md` 记录阶段事实。
5. 不恢复 `apps/web` 作为临时前端；确需浏览器预览时使用 `apps/desktop/frontend` 的 Vite 入口。
6. 不把 BookRun 页面化为第一优先级；长短篇输出统一表达为 Writing Run，BookRun 仅以 managed full-book 兼容实现接入 Desktop。

## 默认入口

- `pnpm dev` 与 `pnpm desktop:dev` 均启动 Desktop IDE 主体验。
- `tauri dev` 通过 `beforeDevCommand` 自动启动 `apps/desktop/frontend` 的 Vite dev server，默认 devUrl 为 `http://localhost:3007`。
- `pnpm dev:maintenance` 只启动基础服务、迁移和 API。

## 短期收口任务

- 持续保持 Desktop 文档统一为 Vite frontend `http://localhost:3007`，不再描述为加载 Web `/ide`。
- 持续保持 README 标注 StoryForge = 作者辅助写作 IDE，`apps/desktop` 是唯一主体验，Web 已退场。
- 持续守住第一阶段验收链路：本地文件审稿 -> 修订 -> diff 确认 -> 真实写回 -> 版本记录；该最小闭环已通过本地验证，后续增强不得绕过 proposed patch 和用户确认。
- 修复当前 Desktop、API、Workflow 红灯门禁，避免架构转向时带着红灯继续堆功能。
- 为 Desktop IDE 增加最小冒烟验证：页面非空、Tauri 命令可用、打开目录、读取文件、保存文件。

## 非目标

- 本决策不改变 API/OpenAPI/workflow 的后端契约职责。
- 本决策不宣称 Desktop IDE 已经具备旧 Web 全部历史页面；它确定后续迁移方向和投资重心。
- 本决策不宣称 BookRun 控制台是主产品入口，也不宣称真实 3-5 万字长程质量验收已经通过。
