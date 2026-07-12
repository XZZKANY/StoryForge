# StoryForge

StoryForge = Cursor for Fiction：一个面向长篇小说创作的 Desktop IDE-first AI 写作工作台。它不是 Web 控制台，也不是“一键出书”的自动生成器，而是让作者在本地小说项目里像用 Cursor 写代码一样写小说——打开文件、与对话式 Agent 讨论、多视角审稿、定向修订、diff 确认、作者确认写回和版本记录。

交互中枢是 Claude Code / Codex 式的**对话式 Agent**：作者用自然语言提要求，Agent 自主调用只读工具（列目录 / 读文件 / 跨文件检索）、一致性与 canon 防漂移观察、文笔静态检查等，读到证据后再作答或生成补丁。写回红线不变——后端绝不直接写盘，所有修订都是作者在界面确认才落盘的 proposed patch。作者还可以在 `.storyforge/agent-instructions.md` 写自定义偏好（语气 / 审稿口径 / 风格禁忌），写盘即生效、不改代码就能调教 Agent。

StoryForge 仍保留可审计的长篇生成流水线（设定、章节目标、检索证据、生成、审稿、修复、记忆回写、制品导出），但它已降级为 Agent 可调用的 tool / 后台重型引擎，不是主产品入口；批量自动整书不再是主线。

> 当前状态（2026-07）：编辑器「安全可日更」阶段（Phase A）已封板，桌面端两轮真机验收通过、锁版 `v0.1.2`；下一步是在编辑器上接续作者创作，在真实写作里 dogfood、由摩擦日志驱动打磨。愿景是一条飞轮：写 → 发 → 收集读者信号 → 喂回 → 进化编辑器 → 写出更有风格的作品。
>
> 质量边界：真实 LLM 1/3/10 章 smoke 有脱敏证据（10 章已人工通读），一次 30 章真实长程跑通链路并导出制品、但人工通读退回重跑；因此**尚不能宣称稳定生产级长篇质量**。真实 3-5 万字长程重跑已换锚为后台轨，待作者连载稳定后重评。
>
> 产品重心：`apps/desktop` 是唯一主体验；`apps/web` 已退场；BookRun 是 Agent tool / 后台重型引擎，不是主产品控制台。最新阶段事实见 [`docs/internal/current-phase.md`](docs/internal/current-phase.md)，工程约定见 [`CLAUDE.md`](CLAUDE.md)。

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

### Desktop 编辑器（主体验）

- **本地项目 IDE**：打开本地小说项目、文件树浏览、Monaco 编辑、版本快照、命令面板，单色语义高亮 + 明暗双主题。
- **对话式 Agent**：项目级对话会话（切文件不丢、消息持久化、左栏会话历史可切换 / 新建），自然语言驱动 LLM 工具循环。
- **只读证据工具**：Agent 自主调用 `fs.list` / `fs.read` / `fs.search`，读到证据再作答，不编造项目里不存在的内容。
- **审稿与修订**：多视角审稿（剧情 / 人物 / 文风 / 连续性）、定向修订、新文件起草，全部走待作者确认的 proposed patch，后端绝不直接写盘。
- **canon 防漂移**：从正文重建在场缓存、校验作者声明的薄不变量、生成场景约束与伏笔健康提示（确定性、无 LLM）。
- **一致性与文笔工具**：机械一致性扫描、深度语义一致性、文笔静态检查、场景承重 / 实体预算 / canon 差量提案等 advisory 工具，挂进 Agent 循环。
- **自定义指令**：`.storyforge/agent-instructions.md` 写盘即生效，作者不改代码就能调 Agent 语气 / 偏好 / 审稿口径。

### 后台生成流水线（Agent tool / 重型引擎）

- **可审计整书闭环**：设定、章节目标、检索证据、逐章生成、自动审稿、定向修复、记忆回写。
- **制品导出**：Markdown、EPUB 和 `audit_report.json`。
- **私测 Alpha 单机后端**：PyInstaller sidecar exe 独立起服、BYO-key、`llm-provider.json` 写盘换模型即生效、NSIS 安装包内嵌 sidecar。

## 当前边界

StoryForge 的编辑器「安全可日更」阶段（Phase A）已封板：桌面端两轮真机验收通过、锁版 `v0.1.2`。下一步是在编辑器上接续作者的 n=1 连载创作，用真实写作 dogfood、由摩擦日志驱动打磨。它已经是一个可日常使用的本地写作编辑器，但还不是成熟商用平台，也还没有验收稳定的生产级长篇质量。

当前可以宣称：

- `apps/desktop` 是唯一主体验，承载本地项目、文件树、Monaco 编辑器、对话式 Agent、diff 确认、写回护栏和版本记录。
- 对话式 Agent 已落地：项目级会话、LLM 工具循环（只读 fs + 一致性 / canon / 文笔 advisory 工具）、多视角审稿、定向修订、新文件起草，均走待确认 proposed patch；真·LLM tool-calling headless 实跑通过。
- 桌面端两轮真机验收（E2E-1 首轮 + 0.1.2 第二轮 A6）全 PASS，含壳子 UI、SSE / REST、中文 IME、canon dossier、权限四轨、单实例与运行控制。
- 私测 Alpha 单机后端已本机验证：sidecar exe 独立起服、BYO-key、写盘换模型即生效、NSIS 内嵌 sidecar。
- 本地 deterministic/mock provider 可跑通最小整书闭环；API / Desktop / Workflow / OpenAPI 契约 / Alembic 单 head 已纳入本地门禁。
- 真实 LLM 1/3/10 章 smoke 有脱敏证据（10 章已人工通读）；一次 30 章真实长程跑通链路并导出 `book.md` / `book.epub` / 审计报告。

当前不能宣称：

- 不能宣称真实 3-5 万字长程质量验收通过（30 章人工通读退回重跑，重跑已换锚为后台轨）。
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

当前路线是一条「写 → 发 → 收集信号 → 喂 → 进化编辑器」的飞轮，分四段推进：

1. **编辑器做到「安全可日更」（Phase A，已封板）**：Rust 写侧 containment、单实例守卫、0.1.2 重建、真机观感波与修复锁版均已完成，tag `v0.1.2`。
2. **在编辑器上写作品（Phase B，进行中）**：手稿保险（仓库外 git init + 定时自动 commit）→ 接续 n=1 连载创作；写作即 dogfood，摩擦日志每周至多驱动一刀 QoL。
3. **发布与信号采集（Phase C）**：发平台、如实标注 AI、采集章节跟读率 / 流量构成 / 模型稿→定稿 delta 等读者信号。
4. **喂回与编辑器进化（Phase D）**：读者信号沉淀为可迁移 playbook，反哺 Agent 工具与编辑器本身。

后台轨（不排期，n=1 连载稳定后重评）：重跑真实 3-5 万字长程 + 人工盲评；BookRun 维持后台工具；一致性能力持续做成 Agent 工具挂进循环。

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
