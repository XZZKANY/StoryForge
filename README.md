# StoryForge

StoryForge = Cursor for Fiction：一个面向小说项目的 Desktop IDE-first AI 写作工作台。它的第一阶段目标不是 Web 控制台或自动出书机，而是让作者在本地小说项目中像用 Cursor 写代码一样写小说：打开文件、Agent 审稿、定向修订、diff 确认、真实写回和版本记录。

StoryForge 仍保留可审计的长篇生成流水线能力：设定、章节目标、检索证据、生成、审稿、修复、记忆回写和制品导出。但 BookRun 是 Agent 可调用 tool / 后台重型引擎，不是第一阶段主产品入口。

> 当前状态：StoryForge 已完成本地最小整书闭环、真实 LLM 1/3/10 章 smoke 验证和一次 30 章真实长程运行。30 章运行链路与制品导出完成，但人工通读结论为“退回重跑”，因此还不能宣称具备稳定生产级长篇质量。
>
> 产品重心：StoryForge = Cursor for Fiction。`apps/desktop` 是唯一主体验；`apps/web` 已退场，不再作为维护、调试、兼容或契约验证入口；BookRun 是 Agent tool / 后台重型引擎，不是主产品控制台。
>
> 当前阶段状态与未完成验收项见 `docs/internal/current-phase.md`。详细架构见 `CLAUDE.md`。

## 目录

- [核心能力](#核心能力)
- [当前边界](#当前边界)
- [技术栈](#技术栈)
- [仓库结构](#仓库结构)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [真实 LLM 验证](#真实-llm-验证)
- [验证记录](#验证记录)
- [路线图](#路线图)
- [贡献](#贡献)

## 核心能力

- **作品设定**：管理作品、角色、世界观、时间线和风格包。
- **章节规划**：从 Blueprint 拆解章节目标、节奏约束和检索锚点。
- **上下文检索**：通过 Story Memory、Character Bible、Scene Packet 和 RAG 证据组织章节上下文。
- **逐章生成**：由 Scene Architect、Draft Writer 等节点驱动章节草稿生成。
- **自动审稿**：覆盖叙事、人物、世界观、时间线、风格和系统可靠度等质量维度。
- **定向修复**：根据 Judge 结果触发 Repair Patch，保留修订前后差异。
- **记忆注入**：抽取章节新增事实，写回 Story Memory，供后续章节复用。
- **制品导出**：导出 Markdown、EPUB 和 `audit_report.json`。

## 当前边界

StoryForge 仍处在真实长程验收整改阶段；Cursor for Fiction Phase 1 的 Desktop IDE 最小闭环已经在本地验证通过。它适合用来研究和改进可验证的 AI 小说生产流水线，也已具备 Desktop IDE Agent 的本地文件审稿、修订、diff 确认、写回和版本记录链路；但不应该被视为成熟的商用写作平台。

当前可以宣称：

- `apps/desktop` 是唯一主体验，承载本地项目、文件树、编辑器、Agent 对话、diff 确认、写回和版本记录方向。
- BookRun 是 Agent tool / 后台重型引擎，可被 Desktop Agent 调用或由后端运行，不是第一阶段主产品入口。
- 本地 deterministic/mock provider 可以跑通最小整书闭环。
- API、Desktop、Workflow、OpenAPI 契约和 Alembic 单 head 已纳入本地验证。
- 真实 LLM 1 章、3 章和 10 章 smoke 已有脱敏证据，其中 10 章 smoke 已通过人工通读。
- 30 章真实长程运行已经完成并导出 `book.md`、`book.epub` 和审计报告。
- Cursor for Fiction Phase 1 最小闭环已通过本地验证：打开本地项目、选择 Markdown、Agent 多视角审稿、按 issue 定向修订、proposed patch/diff 确认、真实 Tauri 写回和版本记录。

当前不能宣称：

- 不能宣称真实 3-5 万字长程质量验收通过。
- 不能把自动审计满分等同于人工通读通过。
- 不能承诺稳定生产级长篇小说生成质量。
- 不能把 `apps/web` 或 BookRun 控制台描述为主产品入口。
- 不能承诺完整多人协作、生产级对象存储签名下载或全步骤 Studio 编排已经完成。

最新阶段事实以 [`docs/internal/current-phase.md`](docs/internal/current-phase.md) 为准。

## 技术栈

- **Desktop IDE 主体验**：Tauri、Vite、React、Monaco Editor、本地文件系统集成
- **Agent tool / 后台引擎**：BookRun、Judge、Repair、Story Memory、导出能力
- **API**：FastAPI、Pydantic、SQLAlchemy、Alembic
- **Workflow**：LangGraph、本地兼容运行时、checkpoint、provider adapter
- **基础设施**：PostgreSQL + pgvector、Redis、MinIO、Docker Compose
- **共享契约**：OpenAPI、`@storyforge/shared`
- **工具链**：pnpm、uv、pytest、Ruff、ESLint、Prettier、Playwright

## 仓库结构

```text
StoryForge/
├── apps/
│   ├── api/          # FastAPI 业务 API、领域模型、迁移和测试
│   ├── desktop/      # Tauri 桌面 IDE，唯一主产品体验
│   └── workflow/     # BookRun 后台重型引擎、技能节点、运行时和质量门禁
├── packages/
│   └── shared/       # OpenAPI 生成类型、共享契约和工具
├── docs/
│   ├── architecture/ # 架构和接口约束
│   ├── internal/     # 当前阶段、TODO、项目摘要等事实源
│   └── operations/   # 本地启动、故障排查、发布检查
├── scripts/          # 本地验证、OpenAPI 生成、开发启动脚本
└── tests/            # 跨服务 e2e 与契约测试
```

## 快速开始

### 前置条件

- Node.js
- pnpm 9.15.4
- Python 3.11+
- uv
- Docker / Docker Compose

### 启动本地环境

```powershell
git clone https://github.com/XZZKANY/StoryForge.git
cd StoryForge
Copy-Item .env.example .env
pnpm install
npm --prefix apps/desktop/frontend install
docker compose up -d postgres redis minio
pnpm dev
```

默认入口：

- Desktop IDE：`pnpm dev` 或 `pnpm desktop:dev`
- Desktop frontend devUrl：http://localhost:3007
- API：http://localhost:8000
- MinIO Console：http://localhost:9001

StoryForge 当前采用 Cursor for Fiction / IDE-first 产品方向：`apps/desktop` 是唯一主体验，旧 Web 入口已经退场，BookRun 作为 Agent tool / 后台重型引擎保留。产品方向见 [`docs/architecture/ide-first-product-direction.md`](docs/architecture/ide-first-product-direction.md)。

本地默认使用 deterministic/mock provider，不需要真实 LLM 密钥即可启动和跑基础验证。

Windows PowerShell 如果阻止 `pnpm.ps1`，可以改用 `pnpm.cmd`：

```powershell
pnpm.cmd dev
```

## 常用命令

```powershell
pnpm dev            # 启动桌面 IDE 主体验
pnpm desktop:dev    # 同上，显式桌面端入口
pnpm desktop:build  # 构建桌面安装包
pnpm dev:maintenance # 启动基础服务和 API，并执行必要迁移
pnpm dev:api        # 只启动 API
pnpm verify         # 本地核心门禁
pnpm test           # Desktop、Shared、API、Workflow 测试
pnpm e2e            # OpenAPI 刷新 + 真实 HTTP / 契约测试
pnpm openapi        # 重新生成 OpenAPI 契约
pnpm lint           # ESLint + Prettier 检查
pnpm lint:fix       # 自动修复可修复的格式和 lint 问题
```

更多启动和故障排查说明见 [`docs/operations/local-start.md`](docs/operations/local-start.md) 与 [`docs/operations/troubleshooting.md`](docs/operations/troubleshooting.md)。

## 真实 LLM 验证

真实 provider 配置必须来自本机私有环境变量，不要把 API key、token、secret 或 password 写入仓库、日志或验证报告。

```powershell
cd apps/api
uv run python -m app.domains.book_runs.book_generation --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.book_generation --chapter-count 3 --token-budget 24000
```

已落盘的脱敏验证样例：

- 1 章 smoke：`.codex/real-llm-1ch-20260603-142925`
- 3 章 smoke：`.codex/real-llm-3ch-20260603-173932`
- 10 章 smoke：`.codex/real-llm-10ch-20260604-110831`
- 30 章长程：`.codex/real-llm-30ch-mimo25pro-20260611-192356`

10 章样例已经通过人工通读；30 章样例只能证明运行链路和制品导出完成，质量验收尚未通过。

## 验证记录

| 验证轮次    | 章节 | Token 消耗 | 运行链路 | 人工通读 |
| ----------- | ---: | ---------: | -------- | -------- |
| 1 章 smoke  |    1 |          - | 通过     | 通过     |
| 3 章 smoke  |    3 |     14,158 | 通过     | 通过     |
| 10 章 smoke |   10 |    145,668 | 通过     | 通过     |
| 30 章长程   |   30 |    261,436 | 通过     | 退回重跑 |

30 章长程的主要阻塞包括测试痕迹残留、章节结构模板化、重复表达、人物称谓混乱、17/18 章时间线冲突、线索膨胀和结尾收束不足。

## 路线图

当前优先级：

1. 基于 30 章人工通读意见整改长程生成策略。
2. 重跑真实 3-5 万字长程，并执行人工通读、Markdown、EPUB 和审计报告验收。
3. 持续守住 Cursor for Fiction Phase 1 闭环，不绕过 proposed patch、diff 确认、真实写回和版本记录。
4. 将 BookRun 保持为 Agent tool / 后台重型引擎，不把控制台作为主产品入口。
5. 补齐 streaming 响应、多租户认证、生产级制品下载和 Desktop 内的全步骤交互编排。

## 贡献

欢迎 Issue 和 PR。提交前建议至少运行：

```powershell
pnpm verify
pnpm test
pnpm e2e
```

贡献时请注意：

- Python 代码遵循 Ruff，Desktop/Shared TypeScript 代码遵循 TypeScript、ESLint 和 Prettier。
- API 变更需要同步 OpenAPI，并检查 `packages/shared/src/contracts/storyforge.openapi.json` 是否产生预期 diff。
- 涉及迁移时必须确认 Alembic 仍为单 head。
- 验证结论应记录到 `.codex/verification-report.md` 或在 PR 中附带关键命令输出。
- 不要提交真实 provider token、API key、secret、password 或未脱敏运行日志。

更多工程约定见 [`CLAUDE.md`](CLAUDE.md)。
