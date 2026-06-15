# IDE-first product direction

生成时间：2026-06-15 +08:00

## 决策

StoryForge 后续主产品体验以 Desktop IDE 为中心。Web 不再作为主体验继续扩展，而是进入维护模式，承担调试、兼容、契约验证和后端能力观察职责。

## 背景

当前仓库同时存在两条前端主线：

- `apps/web`：Next.js 工作台，承载 Home、Studio、Blueprints、Runs、Artifacts、IDE 等页面和大量契约测试。
- `apps/desktop`：Tauri 桌面 IDE，正在形成本地文件树、Monaco Editor、Assistant 面板、原生菜单和本地文件系统能力。

继续让 Web IDE 和 Desktop IDE 同时作为主体验，会导致入口、文档、测试、端口、组件职责和用户心智持续分裂。因此需要明确产品重心。

## 职责边界

### Desktop IDE

Desktop IDE 是面向创作者的主入口，优先承载以下体验：

- 本地项目打开、文件树、编辑器、保存和监听。
- Assistant 对话、章节审阅、生成、修复和写回。
- BookRun 启动、进度、暂停、恢复、审计和导出。
- 与本地 API、workflow、文件系统和未来离线能力的集成。

### Web

Web 进入维护模式，保留以下用途：

- API/BFF 契约测试和服务端渲染验证。
- 旧链接 redirect 和低成本兼容入口。
- 调试控制台、诊断面板和后端能力观察。
- 尚未迁移到 Desktop IDE 的临时工作台。

Web 不再承接新的大规模主体验改造；除非修复门禁、兼容迁移或提供调试能力，不继续投入 Web UI 打磨。

### API 和 Workflow

API 与 Workflow 继续作为共享后端能力，不绑定具体前端形态：

- `apps/api` 负责业务 API、OpenAPI、数据模型、运行记录和制品。
- `apps/workflow` 负责生成编排、checkpoint、provider adapter 和质量门禁。
- Desktop IDE 和 Web 都应通过稳定契约访问这些能力。

## 迁移原则

1. 先冻结 Web 主体验，再迁移核心链路到 Desktop IDE。
2. 不直接删除 Web；先保留契约测试和调试入口，直到 Desktop IDE 有等价验证覆盖。
3. 每迁移一条链路，补一条 Desktop IDE 级健康检查或端到端验证。
4. 文档以 `docs/architecture/ide-first-product-direction.md` 记录产品方向，以 `docs/internal/current-phase.md` 记录阶段事实。
5. 新功能默认落在 Desktop IDE；只有后端调试、契约验证或兼容入口才优先落在 Web。

## 短期收口任务

- 将 Desktop 文档统一为 Vite frontend `http://localhost:3007`，不再描述为加载 Web `/ide`。
- 将 README 标注 Desktop IDE 为主体验，Web 为维护/调试/契约层。
- 修复当前 Web、API、Workflow 红灯门禁，避免架构转向时带着红灯继续堆功能。
- 为 Desktop IDE 增加最小冒烟验证：页面非空、Tauri 命令可用、打开目录、读取文件、保存文件。

## 非目标

- 本决策不要求立即删除 `apps/web`。
- 本决策不改变 API/OpenAPI/workflow 的后端契约职责。
- 本决策不宣称 Desktop IDE 已经具备 Web 全部功能；它只确定后续迁移方向和投资重心。
